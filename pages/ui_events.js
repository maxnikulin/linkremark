
class LrStateStoreComponent {
	constructor(component, mapStateToProps) {
		this.component = component;
		this.mapStateToProps = mapStateToProps;
	}
}

class LrStateStore {
	constructor(reducer, state) {
		this._reducer = reducer;
		this._pendingPromises = [];
		this._components = [];
		this._state = state;
		this._oldState = undefined;
		this.dispatch = this._dispatch.bind(this);
		this.getState = this._getState.bind(this);
		this._applyState = this._doApplyState.bind(this);
	}

	connect(mapStateToProps, mapDispatchToProps) {
		const store = this;
		const dispatchProps = mapDispatchToProps ?
			mapDispatchToProps(store.dispatch) : { dispatch: store.dispatch };
		return function(Component) {
			return class extends Component {
				constructor(props) {
					const mergedProps = {
						...(mapStateToProps ? mapStateToProps(store.getState()) : {}),
						...dispatchProps,
						...(props || {}),
					};
					super(mergedProps);
					this.props = mergedProps;
					this.ownProps = props;
					if (mapStateToProps) {
						store.registerComponent(
							this,
							state => ({
								...(this.ownProps || {}),
								...dispatchProps,
								...mapStateToProps(state) || {},
							}),
						);
					}
				}
			}
		}
	}

	registerComponent(component, mapStateToProps, registerDispatch) {
		const compObject = new LrStateStoreComponent(component, mapStateToProps);
		// a hack to update parent before children
		this._components.unshift(compObject);
		if (registerDispatch) {
			registerDispatch(this.dispatch);
		}
		const mapState = compObject.mapStateToProps;
		if (mapState != null) {
			const newProps = mapState(this._state);
			compObject.component.updateProps(newProps);
			// Set `props` only if `updateProps` completed without exceptions.
			compObject.props = newProps;
		}
	}

	_dispatch(action) {
		const t = Object.prototype.toString.apply(action);
		if (t === '[object Function]' || t === '[object AsyncFunction]') {
			action = action(this.dispatch, this.getState);
		}
		if (action == null) {
			console.warn("LrStateStore: dispatch called with no action");
			return action;
		}
		if (action.then) {
			const tThen = Object.prototype.toString.apply(action.then);
			if (tThen === '[object Function]' || tThen === '[object AsyncFunction]') {
				const result = action.then(
					r => this._onPromiseResolve(action, r),
					e => this._onPromiseReject(action, e));
				this._pendingPromises.push(action);
				return result;
			}
		}
		this._state = this._reducer(this._state, action);
		if (this._state !== this._oldState) {
			Promise.resolve().then(this._applyState);
		}
		return action;
	}

	_getState() {
		return this._state;
	}

	_doApplyState() {
		if (this._oldState === this._state) {
			return;
		}

		for (const c of this._components) {
			try {
				if (c.mapStateToProps == null) {
					continue;
				}
				const newProps = c.mapStateToProps(this._state);
				if (newProps !== c.props) {
					c.component.updateProps(newProps);
					// Set `props` only if `updateProps` completed without exceptions.
					c.props = newProps;
				}
			} catch (ex) {
				console.error("LrStateStore: error while applying state to %o: %o", c, ex);
			}
		}
		this._oldState = this._state;
	}

	_onPromiseResolve(action, _result) {
		this._removePromise(action);
		return action;
	}

	_onPromiseReject(action, ex) {
		this._removePromise(action);
		throw ex;
	}

	_removePromise(action) {
		const i = this._pendingPromises.indexOf(action);
		if (!(i >= 0)) {
			console.error("LrStateStore: internal error: unknown promise %o", action);
		} else {
			this._pendingPromises.splice(i, 1);
		}
	}
}

var LrEventActions = {
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

function LrCombinedReducer(map, initState = {}) {
	return function lrCombinedReducer(state = initState, action) {
		const {type} = action;
		const key = type.substring(0, type.indexOf("/"));
		const handler = map.get(key);
		if (handler) {
			const substate = state[key];
			const result = handler(substate, action);
			if (result !== substate) { // FIXME shallow equal
				state = { ...state, [key]: result };
			}
		}
		if (!handler) {
			console.error("lrCombinedReducer: unknown action: %o %o %o", key, type, action)
		}
		return state;
	};
}

function lrPermissionsReducer(state = {}, {type, data}) {
	switch (type) {
		case "permissions/added": {
			const perms = data.permissions || [];
			const updates = data.permissions.filter(p => !state[p] || !state[p].state);
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
			const perms = data.permissions || [];
			const updates = data.permissions.filter(p => state[p] && state[p].state);
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
			if (!data.permissions) {
				break;
			}
			const diff = new Map(data.permissions.map(k => [k, true]));
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
			for (const p of data.permissions && data.permissions.permissions || []) {
				const prop = permissions[p] = { ...(permissions[p] || {}) };
				prop.requests = prop.requests ? prop.requests.slice() : [];
				const ind = prop.requests.findIndex(r => r.id === data.id);
				if (type === "permissions/request/started") {
					if (ind >= 0) {
						console.error("lrEventReducer: id already exists %o %o", type, data);
						prop.requests.splice(ind, 1);
					}
					prop.requests = prop.requests.filter(r => r.error == null);
					prop.requests.push({id: data.id});
				} else if (type === "permissions/request/completed") {
					if (ind >= 0) {
						prop.requests.splice(ind, 1);
					} else {
						console.error("lrEventReducer: id does not exists %o %o", type, data);
					}
				} else if (type === "permissions/request/failed") {
					if (ind >= 0) {
						prop.requests.splice(ind, 1);
						prop.requests.push({ id: data.id, error: data.error });
					} else {
						console.error("lrEventReducer: id does not exists %o %o", type, data);
					}
				} else {
					console.error("lrEventReducer: unknown subaction %o %o", type, data);
				}
			}
			return permissions;
			break;
		}
		default:
			console.error("lrEventReducer: unknown action %o %o", data, type);
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
		this._dispatch(LrEventActions.permissionsAdded(permissions));
	}
	_onRemoved(permissions) {
		this._dispatch(LrEventActions.permissionsRemoved(permissions));
	}
	async _getAll(dispatch) {
		return dispatch(LrEventActions.permissionsCurrent(await bapi.permissions.getAll()));
	}
	async change(request, permissions) {
		const id = this._getNewId();
		this._dispatch(LrEventActions.permissionRequestStarted(id, permissions));
		try {
			if (await (request ? bapi.permissions.request(permissions)
				: bapi.permissions.remove(permissions))) {
				this._dispatch(LrEventActions.permissionRequestCompleted(id, permissions));
			} else {
				this._dispatch(LrEventActions.permissionRequestFailed(id, permissions, "Request declined"));
			}
		} catch (ex) {
			this._dispatch(LrEventActions.permissionRequestFailed(id, permissions, ex));
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
