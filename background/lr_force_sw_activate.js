/*
   Copyright (C) 2024 Max Nikulin

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

/* <https://crbug.com/1271154>
 * "Issue 1271154: MV3 service worker broken after auto-update and manual refresh"
 * Reported: Wed, Nov 17, 2021, 3:08 PM UTC
 *
 * <https://crbug.com/1445429>
 * "Issue 1445429: MV3: Service worker of unpacked extension is not activated
 * while its pages are open"
 * Reported: Chrome-113, Mon, May 15, 2023, 5:27 AM UTC
 *
 * Delay between `install` and `activate` events
 * (`runtime.onInstalled` is not fired)
 * for an interval while extension pages are open.
 * It should not happen accordingly to
 * <https://developer.chrome.com/docs/extensions/mv3/service_workers/service-worker-lifecycle/#active>
 */

var lr_force_sw_activate_timeoutId;
self.addEventListener("install", function lrOnSWInstall() {
	lr_force_sw_activate_timeoutId = setTimeout(
		function lr_force_sw_activate_watchdog() {
			if (lr_force_sw_activate_timeoutId === undefined) {
				return;
			}
			console.error("LR watchdog: SW no activate event " + new Date().toISOString());
			self.skipWaiting();
			lr_force_sw_activate_timeoutId = undefined;
		},
		1000);
});

self.addEventListener("activate", function lrOnSWActivate() {
	if (lr_force_sw_activate_timeoutId !== undefined) {
		lr_force_sw_activate_timeoutId = undefined;
		return;
	}
	console.error("LR watchdog: SW force clients.claim " + new Date().toISOString());
	clients.claim();
});
