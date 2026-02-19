const phoneRegex =
	/iPhone|iPod|Android.+Mobile|SamsungBrowser.+Mobile|Mobile Safari/i;

const tabletRegex = /iPad|Android(?!.*Mobile)|Tablet|Silk/i;

const botRegex =
	/bot|crawl|spider|slurp|baidu|bingpreview|yandex|duckduck|facebookexternalhit|ia_archiver|google/i;

const desktopRegex = /Windows NT|Macintosh|X11|Linux x86_64|CrOS/i;

const tvRegex = /SmartTV|Tizen|Web0S|HbbTV|NetCast|SmartHub|Roku|AFTS/i;

const consoleRegex = /PlayStation|Xbox|NintendoBrowser|NintendoSwitch/i;

const carRegex = /TeslaBrowser|QtCarBrowser|Android Auto|CarBrowser/i;

const iotRegex = /IoT|Embedded|ESP32|Raspbian|FreeBSD|OpenWrt|NAS/i;

export const getUserAgentType = (userAgent: string) => {
	if (botRegex.test(userAgent)) return 'bot';
	else if (phoneRegex.test(userAgent)) return 'phone';
	else if (tabletRegex.test(userAgent)) return 'tablet';
	else if (tvRegex.test(userAgent)) return 'tv';
	else if (consoleRegex.test(userAgent)) return 'console';
	else if (carRegex.test(userAgent)) return 'car';
	else if (iotRegex.test(userAgent)) return 'iot';
	else if (desktopRegex.test(userAgent)) return 'desktop';

	return 'other';
};
