/** Recognize Android's ANR dialog by system resource ID, not app text. */
export const hasAndroidAnrDialog = (xml: string) =>
	/\bresource-id="android:id\/aerr_(?:close|wait)"/u.test(xml);
