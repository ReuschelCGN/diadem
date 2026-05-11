import * as m from "@/lib/paraglide/messages";
import { openToast } from "@/lib/ui/toasts.svelte.js";
import maplibre, { type LngLatLike } from "maplibre-gl";
import { tick } from "svelte";

let geolocationEnabled: boolean = $state(false);
let isFetchingLocation: boolean = $state(false);
let animateLocationMarker: boolean = $state(false);
let currentLocation: undefined | LngLatLike = $state(undefined);

export function getIsGeolocationEnabled() {
	return geolocationEnabled;
}

export function getIsFetchingLocation() {
	return isFetchingLocation;
}

export function getCurrentLocation() {
	return currentLocation;
}

export function getAnimateLocationMarker() {
	return animateLocationMarker;
}

export function setAnimateLocationMarker(state: boolean) {
	animateLocationMarker = state;
}

async function getGeolocationPermissionsState() {
	const permissions = await window.navigator.permissions.query({ name: "geolocation" });
	return permissions.state;
}

function handleGeolocationError(e: GeolocationPositionError) {
	if (e.code === 1) {
		openToast(m.locate_error_perms());
	} else if (e.code === 2 || e.code === 3) {
		openToast(m.locate_error_timeout());
	} else {
		openToast(m.locate_error_unknown());
	}

	geolocationEnabled = false;
	currentLocation = undefined;
}

export async function updateGeolocationEnabled(showResult: boolean = false) {
	let errorReason = "";
	let geolocationOk: boolean = false;

	if (!window.navigator.permissions) {
		geolocationOk = !!window.navigator.geolocation;
		if (!geolocationOk) errorReason = m.locate_error_support();
	} else {
		try {
			const permsState = await getGeolocationPermissionsState();
			geolocationOk = permsState !== "denied";
			if (!geolocationOk) errorReason = m.locate_error_perms();
		} catch {
			// Fix for iOS16 which rejects query but still supports geolocation
			geolocationOk = !!window.navigator.geolocation;
			if (!geolocationOk) errorReason = m.locate_error_support();
		}
	}

	geolocationEnabled = geolocationOk;
	if (!geolocationOk && showResult && errorReason) {
		openToast(errorReason);
	}
	return geolocationOk;
}

function handleGeolocationPosition(s: GeolocationPosition, map: maplibre.Map | undefined) {
	if (!shouldUpdateLocation) return;

	const hadLocation = !!currentLocation;
	let heading = currentLocation?.heading;
	let shouldMove = true;
	const locationCoords = {
		lng: round(s.coords.longitude, 6),
		lat: round(s.coords.latitude, 6)
	};

	if (currentLocation) {
		const distanceMeters = distance(
			[currentLocation.lng, currentLocation.lat],
			[locationCoords.lng, locationCoords.lat],
			{ units: "meters" }
		);
		shouldMove = distanceMeters > minLocationUpdateDistanceMeters;
	}

	if (s.coords.heading !== null && Number.isFinite(s.coords.heading)) {
		heading = getContinuousHeading(s.coords.heading);
	} else if (shouldMove && currentLocation) {
		const fromLat = (currentLocation.lat * Math.PI) / 180;
		const toLat = (locationCoords.lat * Math.PI) / 180;
		const lngDelta = ((locationCoords.lng - currentLocation.lng) * Math.PI) / 180;
		const y = Math.sin(lngDelta) * Math.cos(toLat);
		const x =
			Math.cos(fromLat) * Math.sin(toLat) -
			Math.sin(fromLat) * Math.cos(toLat) * Math.cos(lngDelta);

		heading = getContinuousHeading((Math.atan2(y, x) * 180) / Math.PI + 360);
	}

	const location: Location = {
		...locationCoords,
		heading
	};

	isFetchingLocation = false;
	geolocationEnabled = true;

	if (!hadLocation) {
		currentLocation = location;
		if (isLocateFollowing && map) {
			flyToLocation(map, location);
		}
		return;
	}

	if (shouldMove) {
		animateLocation(location, map);
	} else if (currentLocation && currentLocation.heading !== heading) {
		currentLocation.heading = heading;
	}
}

export function updateLocation(map: maplibre.Map | undefined, allowFollow: boolean) {
	if (allowFollow && watchId !== undefined) {
		if (isLocateFollowing) {
			resetLocate();
			return;
		}

		isLocateFollowing = true;

		if (currentLocation && map) {
			flyToLocation(map, currentLocation);
		}
		return;
	}

	if (!navigator.geolocation) {
		geolocationEnabled = false;
		openToast(m.locate_error_support());
		return;
	}

	isFetchingLocation = true;
	shouldUpdateLocation = true;

	if (allowFollow) {
		isLocateFollowing = true;
		watchId = navigator.geolocation.watchPosition(
			(s) => handleGeolocationPosition(s, map),
			(e) => {
				handleGeolocationError(e);
				resetLocate();
			},
			{
				enableHighAccuracy: true,
				maximumAge: 1000,
				timeout: 10000
			}
		);
	} else {
		navigator.geolocation.getCurrentPosition(
			(s) => {
				handleGeolocationPosition(s, map);
				if (map) flyToLocation(map, currentLocation);
				shouldUpdateLocation = watchId !== undefined;
			},
			(e) => {
				handleGeolocationError(e);
				isFetchingLocation = false;
				shouldUpdateLocation = watchId !== undefined;
			},
			{
				enableHighAccuracy: true,
				maximumAge: 1000,
				timeout: 10000
			}
		);
	}
=======
export function updateLocation(map: maplibre.Map | undefined) {
	isFetchingLocation = true;
	navigator?.geolocation?.getCurrentPosition(
		(s) => {
			isFetchingLocation = false;

			if (!map) return;

			currentLocation = {
				lng: s.coords.longitude,
				lat: s.coords.latitude
			};
			map.flyTo({
				center: [s.coords.longitude, s.coords.latitude],
				zoom: 14.5
			});
			tick().then(() => (animateLocationMarker = true));
		},
		(e) => {
			if (e.code === 1) {
				openToast(m.locate_error_perms());
			} else if (e.code === 2) {
				openToast(m.locate_error_timeout());
			} else {
				openToast(m.locate_error_unknown());
			}

			geolocationEnabled = false;
			isFetchingLocation = false;
			currentLocation = undefined;
		},
		{
			enableHighAccuracy: true
		}
	);
}
