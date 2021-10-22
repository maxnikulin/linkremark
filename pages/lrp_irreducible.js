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

/*
 * This is an experiment with keeping global state of web page inspired
 * by Redux https://redux.js.org/ The only purpose is to minimize
 * dependencies since LinkRemark UI is not expected to be really complex.
 * It may have incompatibilities requiring some work for migration to Redux.
 * It does not have debug and development tools
 * and some checks catching attempts of incorrect usage.
 */

"use strict";

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
