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

var LrPermissionsActions = {
	permissionsAdded: function(permissions) {
		return { type: "permissions/added", data: permissions };
	},
	permissionsRemoved: function(permissions) {
		return { type: "permissions/removed", data: permissions };
	},
	permissionsCurrent: function(permissions) {
		return { type: "permissions/current", data: permissions };
	},
	permissionRequestStarted: function(id, permissions) {
		return { type: "permissions/request/started", data: { id, permissions } };
	},
	permissionRequestCompleted: function(id, permissions) {
		return { type: "permissions/request/completed", data: { id, permissions } };
	},
	permissionRequestFailed: function(id, permissions, error) {
		return { type: "permissions/request/failed", data: { id, permissions, error } };
	},
}

function lrPermissionsReducer(state = {}, {type, data}) {
	switch (type) {
		case "permissions/added": {
			const perms = (data.permissions || []).concat(data.origins || []);
			const updates = perms.filter(p => !state[p] || !state[p].state);
			if (updates.length > 0) {
				const replace = {};
				for (const p of updates) {
					replace[p] = { ...(state[p] || {}), state: true };
				}
				return { ...state, ...replace };
			}
			break;
		}
		case "permissions/removed": {
			const perms = (data.permissions || []).concat(data.origins || []);
			const updates = perms.filter(p => state[p] && state[p].state);
			if (updates.length > 0) {
				const replace = {};
				for (const p of updates) {
					replace[p] = { ...(state[p] || {}), state: false };
				}
				return { ...state, ...replace };
			}
			break;
		}
		case "permissions/current": {
			if (!data.permissions && !data.origins) {
				break;
			}
			const perms = (data.permissions || []).concat(data.origins || []);
			const diff = new Map(perms.map(k => [k, true]));
			for (const [k, v] of state ? Object.entries(state) : []) {
				if (v && v.state) {
					if (!diff.delete(k)) {
						diff.set(k, false);
					}
				}
			}
			if (diff.size > 0) {
				const updated = { ...state };
				for (const [k, v] of diff) {
					updated[k] = { ...(updated[k] || {}), state: v };
				}
				return updated;
			}
			break;
		}
		case "permissions/request/started":
		case "permissions/request/completed":
		case "permissions/request/failed": {
			const permissions = { ...state };
			const perms = (data.permissions?.permissions || []).concat(data.permissions?.origins || []);
			for (const p of perms) {
				const prop = permissions[p] = { ...(permissions[p] || {}) };
				prop.requests = prop.requests ? prop.requests.slice() : [];
				const ind = prop.requests.findIndex(r => r.id === data.id);
				if (type === "permissions/request/started") {
					if (ind >= 0) {
						console.error("lrPermissionsReducer: id already exists %o %o", type, data);
						prop.requests.splice(ind, 1);
					}
					prop.requests = prop.requests.filter(r => r.error == null);
					prop.requests.push({id: data.id});
				} else if (type === "permissions/request/completed") {
					if (ind >= 0) {
						prop.requests.splice(ind, 1);
					} else {
						console.error("lrPermissionsReducer: id does not exists %o %o", type, data);
					}
				} else if (type === "permissions/request/failed") {
					if (ind >= 0) {
						prop.requests.splice(ind, 1);
						prop.requests.push({ id: data.id, error: data.error });
					} else {
						console.error("lrPermissionsReducer: id does not exists %o %o", type, data);
					}
				} else {
					console.error("lrPermissionsReducer: unknown subaction %o %o", type, data);
				}
			}
			return permissions;
			break;
		}
		default:
			console.error("lrPermissionsReducer: unknown action %o %o", data, type);
	}
	return state;
}

class LrPermissionsEvents {
	constructor() {
		this._subscriptions = [];
		this._permissions_onAdded = this._onAdded.bind(this);
		this._permissions_onRemoved = this._onRemoved.bind(this);
	}
	subscribe(dispatch) {
		if (this._subscriptions.length === 0) {
			bapi.permissions.onAdded.addListener(this._permissions_onAdded);
			bapi.permissions.onRemoved.addListener(this._permissions_onRemoved);
		}
		this._subscriptions.push(dispatch);
		dispatch(this._getAll(dispatch));
	}
	unsubscribe(dispatch) {
		const i = this._subscriptions.indexOf(dispatch);
		if (i >= 0) {
			this._subscriptions.splice(i, 1);
		} else {
			console.warn(
				"LrPermissionsEvents: attempt to remove non-existing subscription %o",
				dispatch);
		}
		if (this._subscriptions.length === 0) {
			bapi.permissions.onAdded.removeListener(this._permissions_onAdded);
			bapi.permissions.onRemoved.removeListener(this._permissions_onRemoved);
		}
	}
	_onAdded(permissions) {
		this._dispatch(LrPermissionsActions.permissionsAdded(permissions));
	}
	_onRemoved(permissions) {
		this._dispatch(LrPermissionsActions.permissionsRemoved(permissions));
	}
	async _getAll(dispatch) {
		return dispatch(LrPermissionsActions.permissionsCurrent(await bapi.permissions.getAll()));
	}
	async change(request, permissions) {
		const id = this._getNewId();
		this._dispatch(LrPermissionsActions.permissionRequestStarted(id, permissions));
		try {
			if (await (request ? bapi.permissions.request(permissions)
				: bapi.permissions.remove(permissions))) {
				this._dispatch(LrPermissionsActions.permissionRequestCompleted(id, permissions));
			} else {
				this._dispatch(LrPermissionsActions.permissionRequestFailed(id, permissions, "Request declined"));
			}
		} catch (ex) {
			this._dispatch(LrPermissionsActions.permissionRequestFailed(id, permissions, ex));
		}
	}
	_dispatch(action) {
		for (const dispatch of this._subscriptions) {
			try {
				dispatch(action);
			} catch (ex) {
				console.error("LrPermissionsEvents: subscriber disptch failure %o %o %o", ex, action, dispatch);
			}
		}
	}
	_getNewId() {
		const id = Date.now();
		if (this._lastId >= id) {
			++this._lastId;
		} else {
			this._lastId = id;
		}
		return this._lastId;
	}
}
