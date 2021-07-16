/*
   Copyright (C) 2020 Max Nikulin

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

class LrMentionsQuery {
	constructor(props) {
		const fragment = new DocumentFragment();
		const exec = E('button', null, "Check");
		exec.addEventListener("click", ev => {
			ev.preventDefault();
			this.props.onexec();
		}, false);
		fragment.append(
			E('div', { className: 'limitedWidth' },
				E('label', { className: 'flexLineContainer' },
					E('div', { className: 'flexFixed fixed' }, 'App Name'),
					E('input', { className: 'long', name: 'name' }),
				),
			),
			E('div', { className: "scroll flexGrow" }, E('textarea', {
				name: "urls",
				className: "limitedWidth",
				rows: 3,
				cols: 132,
			})),
			E('div', { className: "limitedWidth" }, exec, "One URL per line"),
		);
		this.dom = E('form', null, fragment);
		this.dom.addEventListener("change",
			ev => {
				const value = ev.target.type === "checkbox" ? ev.target.checked : ev.target.value;
				this.props.onchange({ name: ev.target.name, value });
			},
			false);
	}
	updateProps(props) {
		this.props = props;
		this.dom.elements.name.value = props && props.name && props.name.value || "";
		this.dom.elements.urls.value = props && props.urls && props.urls.value || "";
	}
}

class LrMentionsResult {
	constructor(props) {
		this.dom = E('ul', { className: "tree limitedWidth" });
		this.listener = ev => {
			if (!this.props || !this.props.onclick) {
				console.warn("LrMentionsResult: props.onclick not specified");
				return;
			}
			if (ev instanceof KeyboardEvent) {
				if (ev.key !== 'Enter' && ev.key !== ' ') {
					return;
				} else {
					ev.preventDefault();
				}
			}
			let target = ev.target;
			if (target.dataset.lrPath == null) {
				target = target.parentNode;
			}
			if (target.dataset.lrPath == null) {
				return;
			}
			this.props.onclick({ lineNo: target.dataset.lrLineNo, path: target.dataset.lrPath });
		}
		this.updateProps(props);
	}
	updateProps(props) {
		this.props = props;
		this.dom.removeEventListener("click", this.listener);
		this.dom.removeEventListener("keydown", this.listener);
		if (props && props.onclick) {
			this.dom.addEventListener("click", this.listener, false);
			this.dom.addEventListener("keydown", this.listener, false);
		}
		const fragment = new DocumentFragment();
		const queue = [];
		if (!props || !props.mentions) {
			fragment.append(E('li', null, "Internal error"));
		} else if (typeof props.mentions === "string") {
			fragment.append(E('li', null, props.mentions));
		} else {
			queue.push({ item: props.mentions });
		}
		const stack = [ { node: fragment } ];
		const canVisit = props && props.onclick &&
			props.hello && props.hello.capabilities &&
			(props.hello.capabilities.indexOf("visit") >= 0);
		const captionAttrs = canVisit ? { role: "button", tabindex: 0 } : null
		while (queue.length > 0) {
			const { item, post } = queue.pop();
			if (post) {
				if (item._type !== "Body") {
					stack.pop();
				}
				continue;
			}

			const caption = [];
			const path = stack[stack.length - 1].path || item.path;
			if (item.lineNo) {
				caption.push(E('span', null, item.lineNo), ": ");
			}
			const title = item.title || item.rawText || item.path;
			if (title) {
				caption.push(item._type === "Heading" ? "* " : (item._type || "Link") + ": ");
				caption.push(E('span', null, title));
			} else if (item.descr || item.url) {
				caption.push(item._type || "Link", ": ");
				if (item.descr) {
					caption.push(E('span', null, item.descr));
				}
				if (item.url) {
					if (item.descr) {
						caption.push(" ");
					}
					caption.push(E('span', null, item.url));
				}
			}
			if (item.total > 1) {
				let text;
				if (caption.length > 0) {
					if (item.total > item.filtered) {
						text = `(${item.filtered}/${item.total})`;
					} else {
						text = `(${item.total})`;
					}
				} else {
					if (item.total > item.filtered) {
						text = `${item.filtered} of ${item.total} links`;
					} else {
						text = `${item.total} links`;
					}
				}
				caption.push(" ", E('span', null, text));
			}
			const { node } = stack[stack.length - 1];
			const children = item.children || item.links;
			const attrs = path ? captionAttrs : null;
			const captionElement = E('span', attrs, ...caption);
			if (path) {
				captionElement.dataset.lrPath = path;
			}
			if (item.lineNo) {
				captionElement.dataset.lrLineNo = item.lineNo;
			}
			const elements = item._type === "Body" ? [] : [ captionElement ];
			if (children) {
				queue.push({ item, post: true });
				queue.push(...children.map(it => ({item: it})));
				if (item._type !== "Body") {
					const ul = E('ul');
					elements.push(ul);
					stack.push({ node: ul, path });
				}
			}
			if (elements.length > 0) {
				node.append(E('li', null, ...elements));
			}
		}
		this.dom.innerText = "";
		this.dom.append(fragment);
	}
}

function lrMentionsReducer(state = { mentions: "NO_MENTIONS" }, { type, data }) {
	switch(type) {
		case "mentions/result":
			return { ...state, mentions: data && data.mentions, hello: data && data.hello };
		case "mentions/change": {
			const priorityMap = { settings: -20, capture: -10 };
			const { name, value, source } = data;
			const currentPriority = state && state.query && state.query[name] &&
				state.query[name].source || -100;
			if ((priorityMap[source] || 0) < currentPriority) {
				return state;
			}
			const query = state.query || {};
			const field = query[name] || {};
			return { ...state, query: { ...query, [name]: { value, source } } };
		}
		default:
			console.error("lrMentionsReducer: invalid action %o %o", type, data);
			lrPreviewLogException(null, {
				message: "Internal error",
				error: new Error(`Unsupported action "${type}"`),
			});
	}
	return state
}

var gLrMentionsActions = {
	mentionsQueryChanged: function(nameValSrc) {
		return { type: "mentions/change", data: nameValSrc };
	},
	mentionsResult: function(data) {
		return { type: "mentions/result", data };
	},
	mentionsExec: async function(dispatch, getState) {
		let id;
		try {
			const state = getState();
			const backend = state && state.query && state.query.name && state.query.name.value;
			if (!backend) {
				throw new Error("Native messaging app is not set");
			}
			const urlsText = state && state.query && state.query.urls && state.query.urls.value;
			const variants = urlsText && urlsText.split("\n").map(x => x.trim())
				.filter(x => !!x);
			if (!variants || !(variants.length > 0)) {
				throw new Error("No URLs specified");
			}
			id = bapiGetId();
			dispatch(gLrPreviewLog.started({ id, message: "Checking mentions..." }));
			const hasPermission = await lrRequestNativeMessagingPermission();
			if (!hasPermission) {
				throw new Error("Request for native messaging permission is rejected");
			}
			const result = await lrSendMessage("nativeMessaging.mentions", [ { backend, variants } ]);
			dispatch(gLrMentionsActions.mentionsResult(result));
			dispatch(gLrPreviewLog.finished({ id, message: "Check mentions completed." }));
		} catch (error) {
			lrPreviewLogException({ dispatch, getState }, { id, error });
		}
	},
	visit: function(query) {
		return async function lrMentionsVisit(dispatch, getState) {
			let id = bapiGetId();
			try {
				const file = query && query.path;
				if (!file) {
					throw new Error("Internal error: file to open is not specified");
				}
				const arg = { file };
				const lineNo = query && parseInt(query.lineNo, 10);
				if (lineNo) {
					arg.lineNo = lineNo;
				}
				dispatch(gLrPreviewLog.started({ id, message: "Checking mentions..." }));

				const state = getState();
				const params = {};
				const backend = state && state.query && state.query.name && state.query.name.value;
				if (backend) {
					params.backend = backend;
				}
				const result = await lrSendMessage("nativeMessaging.visit", [ arg, params ]);
				dispatch(gLrPreviewLog.finished({ id, message: "Open mention completed." }));
				return result;
			} catch (error) {
				lrPreviewLogException({ dispatch, getState }, { id, error });
			}
		};
	},
};
