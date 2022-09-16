/*
   Copyright (C) 2021 Max Nikulin

   This program is free software: you can redistribute it and/or modify
   it under the terms of the GNU General Public License as published by
   the Free Software Foundation; either version 3 of the License, or
   (at your option) any later version.

   This program is distributed in the hope that it will be useful,
   but WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   GNU General Public License for more details.

   You should have received a copy of the GNU General Public License
   along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

"use strict";

var LR_PM_DEFAULT_FORMAT_VERSIONS = {
	"object": "0.2",
	"org": "0.2",
	"org-protocol": "0.2",
};

// Notice that "options" field is ignored
function lrPmProjectionIsEmpty(projection) {
	return ["body", "title", "url"].every(field => {
		const value = projection[field];
		return value == null || value === "";
	});
}

function lrPmProjectionIsValid(projection) {
	return projection != null && !projection.error &&
		!lrPmProjectionIsEmpty(projection);
}

function lrPmCaptureForExport(capture, format) {
	if (!capture) {
		return capture;
	}
	function nextFormat(fmt, projection) {
		if (fmt === "org-protocol") {
			const subformat = projection && projection.options && projection.options.format;
			if (subformat) {
				return subformat;
			}
			return "org";
		} else if (fmt === "org") {
			return "object";
		}
		return null;
	}

	let result = [];
	for (let srcId; srcId != null || format ; ) {
		const currentFormatId = capture.current[format];
		if (
			(format === "org" || format === "object") &&
			(srcId !== currentFormatId)
		) {
			const currentProjection = currentFormatId && capture.formats[currentFormatId];
			if (lrPmProjectionIsValid(currentProjection)) {
				srcId = null;
			}
		}
		const projectionId = srcId != null ? srcId : currentFormatId;
		const projection = projectionId && capture.formats[projectionId];
		if (lrPmProjectionIsValid(projection)) {
			if (srcId == null) {
				result.splice(0);
			}
			result.push(projectionId);
			if (projection.modified != null) {
				if (
					!lrPmProjectionsEqual(
						projection, capture.formats[projection.modified], false)
				) {
					break;
				} else {
					// options modified current projection should be dropped
					result.splice(0);
				}
			}
			srcId = projection.src;
			format = projection.format;
		} else {
			srcId = null;
		}
		format = nextFormat(format, projection);
	}

	if (result.length === 0) {
		return null;
	}
	const retval = { transport: { captureId: result[0] }, formats: { } };
	for (const id of result) {
		retval.formats[id] = lrPmProjectionStateToCapture(capture.formats[id]);
	}
	return retval;
}

function lrPmProjectionCaptureToState(projection) {
	if (projection == null) {
		return projection;
	}
	const needConversion = [ "body", "options" ].map(field => {
		const value = projection[field];
		return { field, convert: value != null && typeof value !== "string" };
	});
	if (needConversion.length === 0) {
		return projection;
	}
	const { body, options, ...result } = projection;
	for (const {field, convert} of needConversion) {
		const value = projection[field];
		result[field] = convert ? JSON.stringify(value, null, "  ") : value;
	}
	return result;
}

function lrPmProjectionStateToCapture(projection) {
	if (projection == null) {
		return projection;
	}
	const { body, options, ...result } = projection;
	const { format } = projection;
	if (
		(body == null || format !== "object" || typeof body !== "string") &&
		(options == null || typeof options !== "string")
	) {
		return projection;
	}
	if (body) {
		if (format === "object") {
			if (typeof body === "string") {
				result.body = JSON.parse(body);
			} else {
				console.warn("lrPmProjectionStateToCapture: body is not a string: %o", projection);
				result.body = body;
			}
		} else {
			result.body = body;
		}
	}
	if (options) {
		if (typeof options === "string") {
			result.options = JSON.parse(options);
		} else {
			console.warn("lrPmProjectionStateToCapture: options no a string: %o", projection);
			result.options = options;
		}
	}
	return result;
}

/// Incorporate result of `export.format` RPC call
function lrPmCaptureUpdate(origCapture, updateCapture) {
	if (updateCapture == null) {
		return origCapture;
	}
	let { transport, formats: updateFormats } = updateCapture;
	if (
		transport == null || transport.captureId == null
		|| updateFormats == null || updateFormats[transport.captureId] == null
	) {
		lrPreviewLogException(null, {
			message: "Internal error",
			error: new Error("Invalid capture object"),
		});
		return origCapture;
	}
	const current = { ...(origCapture.current || {}) };
	const formats = { ...(origCapture.formats || {}) };
	let adjust = lr_common.getId();
	const updated = new Set();
	for (
		let projection, projectionId = transport && transport.captureId;
		null != (projection = projectionId && updateFormats[projectionId]);
		projectionId = projection.src
	) {
		const { format } = projection;
		const currentId = current[format];
		if (projectionId === currentId) {
			break;
		}
		const stateProjection = lrPmProjectionCaptureToState(projection);
		if (format !== "object" || updated.size === 0) {
			stateProjection.adjust = adjust;
		}
		formats[projectionId] = stateProjection;
		if (currentId == null) {
			updated.add(format);
			current[projection.format] = projectionId;
		} else if (!updated.has(format)) {
			updated.add(format);
			const currentProjection = formats[currentId];
			if (currentProjection.modified == null) {
				current[format] = projectionId;
			} else {
				formats[currentId] = { ...currentProjection, modified: projectionId };
			}
		}
	}
	return { ...origCapture, formats, current };
}

/// Garbage collector removing unused projections
function lrPmCaptureGc(capture) {
	if (capture == null) {
		return capture;
	}
	const unused = new Set(Object.keys(capture.formats));
	const queue = Object.values(capture.current);
	for (const id of queue) {
		unused.delete("" + id);
	}
	while (queue.length > 0) {
		const projectionId = queue.pop();
		const projection = capture.formats[projectionId];
		if (projection == null) {
			console.warn("lrPmCaptureGc: missed projection %o", projectionId);
			continue;
		}
		for (const id of [projection.src, projection.modified]) {
			if (id != null && unused.delete("" + id)) {
				queue.push(id);
			}
		}
	}
	if (unused.size > 0) {
		const formats = { ...capture.formats };
		for (const id of unused) {
			delete formats[id];
		}
		return { ...capture, formats };
	}
	return capture;
}

function lrPmDefaultProjection(format, options) {
	const version = LR_PM_DEFAULT_FORMAT_VERSIONS[format];
	if (version == null) {
		throw new Error(`No default version for "${format}" format`);
	}
	const projection = { format, version, id: lr_common.getId() };
	if (options != null) {
		projection.options = options;
	}
	return projection;
}

function lrPmProjectionsEqual(a, b, options = true) {
	if (a == null && b == null) {
		return true;
	}
	function normValue(obj, field) {
		const value = obj == null ? null : obj[field];
		return value != null && value != "" ? value : null;
	}
	return [ "body", "title", "url", ...(options ? [ "options" ] : []) ]
		.every(field => normValue(a, field) === normValue(b, field));
}

/// It is necessary to pass result through `lrPmCaptureGc`
function lrPmUpdateProjection(capture, diff) {
	const { format, field, value } = diff;
	const currentId = capture.current[format];
	let current = currentId && capture.formats[currentId];
	if (
		(current == null && (value == null || value === ""))
		|| (current != null && current[field] === value)
	) {
		return capture;
	}

	const newId = lr_common.getId();
	// fake modified on first change
	const projection = {
		...(current != null ? current : lrPmDefaultProjection(format)),
		id: newId,
		modified: current != null && current.modified != null
		? current.modified
		: (currentId != null ? currentId : lr_common.getId()),
		[field]: value,
	};

	const orig = current && current.modified && capture.formats[current.modified];
	if (lrPmProjectionsEqual(projection, orig)) {
		return {
			...capture,
			current: { ...capture.current, [format]: orig && orig.id },
		};
	}
	return {
		...capture,
		formats: { ...capture.formats, [newId]: projection },
		current: { ...capture.current, [format]: newId },
	};
}

function lrPmGetCurrentProjectionFromState(state, options) {
	let { format, nothrow } = options || {};
	if (!format) {
		const { transport } = state;
		format = transport && transport.format;
	}
	if (!format || format === "missed") {
		if (!nothrow) {
			throw new Error("Format is not selected");
		}
		return null;
	}
	const projectionId = state.capture && state.capture.current && state.capture.current[format];
	const projection = projectionId && state.capture && state.capture.formats &&
		state.capture.formats[projectionId];
	if (!projection && !nothrow) {
		throw new Error(`No data for ${format}`);
	}
	return projection;
}

function lrPmStateToTitleProps(state) {
	const props = {};
	props.capture = state.transport && state.transport.captureId;
	const projection = lrPmGetCurrentProjectionFromState(state, { nothrow: true });
	if (projection) {
		props.title = projection.title;
		props.error = projection.error;
	}
	const summary = state.log && state.log.reduce(function lrTitleLogReduce(summary, entry) {
		if (entry.time == null) {
			summary.wait = true;
		} else {
			if (!summary.entry || !(summary.entry.time > entry.time)) {
				summary.entry = entry;
			}
		}
		return summary;
	}, {});
	if (summary) {
		if (summary.wait) {
			props.state = "wait";
		} else if (summary.entry) {
			if (summary.entry.name) {
				props.state = lr_common.isWarning(summary.entry) ? "warning" : "error";
			} else {
				props.state = "success";
			}
		}
	}
	return props;
}
