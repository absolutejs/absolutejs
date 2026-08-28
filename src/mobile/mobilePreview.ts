import { Elysia } from 'elysia';
import type { MobileConfig } from '../../types/build';
import { sendTelemetryEvent } from '../cli/telemetryEvent';

export const ABSOLUTE_MOBILE_PREVIEW_PATH =
	'/__absolute/mobile-preview' as const;

const escapeHtml = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const normalizeEntry = (entry: string | undefined) => {
	const parsed = new URL(entry ?? '/', 'https://absolute.invalid');

	return `${parsed.pathname}${parsed.search}${parsed.hash}`;
};

export const absoluteMobilePreviewDocument = (mobile: MobileConfig) => {
	const entry = normalizeEntry(mobile.entry);
	const appName = mobile.appName?.trim() || 'AbsoluteJS App';
	const boot = JSON.stringify({ appName, entry }).replaceAll('<', '\\u003c');

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<link rel="icon" href="data:,">
<title>${escapeHtml(appName)} · Mobile Preview</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#e8ecf3;background:#080b12;color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 30% 0,#17213a 0,#080b12 42%)}button,input,select{font:inherit}.shell{display:grid;grid-template-columns:minmax(320px,1fr) 292px;gap:24px;min-height:100vh;padding:24px}.stage{display:grid;place-items:center;min-width:0}.device{position:relative;width:min(100%,430px);height:min(880px,calc(100vh - 48px));min-height:620px;padding:12px;border:1px solid #343c4d;border-radius:48px;background:#111620;box-shadow:0 35px 80px #0009,inset 0 0 0 1px #ffffff0d}.device.android{border-radius:30px}.screen{position:relative;width:100%;height:100%;overflow:hidden;border-radius:37px;background:#fff}.android .screen{border-radius:20px}.island{position:absolute;z-index:2;top:17px;left:50%;width:112px;height:30px;transform:translateX(-50%);border-radius:18px;background:#080b12;pointer-events:none}.android .island{width:9px;height:9px;top:10px}.app{width:100%;height:100%;border:0;background:#fff}.panel{align-self:start;position:sticky;top:24px;max-height:calc(100vh - 48px);overflow:auto;padding:18px;border:1px solid #262d3a;border-radius:20px;background:#0e131dcc;box-shadow:0 18px 50px #0005;backdrop-filter:blur(18px)}h1{font-size:18px;margin:0}.sub{margin:5px 0 18px;color:#8f9aae;font-size:12px}.status{display:flex;align-items:center;gap:8px;margin-bottom:18px;padding:9px 11px;border-radius:10px;background:#151c28;color:#aeb8ca;font-size:12px}.dot{width:8px;height:8px;border-radius:50%;background:#eab308}.ready .dot{background:#22c55e}.group{padding:14px 0;border-top:1px solid #252c39}.group:first-of-type{border-top:0}.label{display:block;margin-bottom:8px;color:#97a3b7;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.row{display:flex;gap:8px}.row>*{min-width:0}.grow{flex:1}button,select,input{border:1px solid #30394a;border-radius:9px;background:#171e2b;color:#e8ecf3;padding:9px 10px}button{cursor:pointer}button:hover{border-color:#64748b;background:#202a3a}button.active{border-color:#60a5fa;background:#172b48;color:#bfdbfe}input{width:100%}.events{height:84px;overflow:auto;margin-top:8px;padding:8px;border-radius:9px;background:#090d14;color:#8290a7;font:11px/1.5 ui-monospace,monospace}.hint{margin-top:12px;color:#64748b;font-size:11px;line-height:1.45}@media(max-width:840px){.shell{grid-template-columns:1fr;padding:12px}.device{height:720px}.panel{position:static;max-height:none}}
</style>
</head>
<body>
<main class="shell">
<section class="stage"><div class="device" id="device"><div class="island"></div><div class="screen"><iframe class="app" id="app" title="${escapeHtml(appName)} mobile runtime"></iframe></div></div></section>
<aside class="panel">
<h1>${escapeHtml(appName)}</h1><p class="sub">AbsoluteJS mobile runtime preview</p>
<div class="status" id="status"><span class="dot"></span><span id="statusText">Starting runtime…</span></div>
<div class="group"><span class="label">Device</span><div class="row"><button id="ios" class="grow active">iOS</button><button id="android" class="grow">Android</button></div></div>
<div class="group"><label class="label" for="route">Route / deep link</label><div class="row"><input id="route" value="${escapeHtml(entry)}"><button id="go">Go</button></div><div class="row" style="margin-top:8px"><button id="deepLink" class="grow">Emit deep link</button><button id="back" class="grow">Hardware back</button></div></div>
<div class="group"><span class="label">Connection</span><div class="row"><button id="online" class="grow active">Wi-Fi</button><button id="cellular" class="grow">Cellular</button><button id="offline" class="grow">Offline</button></div></div>
<div class="group"><span class="label">Lifecycle</span><div class="row"><button id="active" class="grow active">Active</button><button id="background" class="grow">Background</button><button id="inactive" class="grow">Inactive</button></div></div>
<div class="group"><span class="label">Keyboard</span><div class="row"><button id="keyboardShow" class="grow">Show</button><button id="keyboardHide" class="grow">Hide</button></div></div>
<div class="group"><label class="label" for="permission">Permissions</label><div class="row"><select id="permission" class="grow"><option value="camera">Camera</option><option value="location">Location</option><option value="notifications">Notifications</option></select><select id="permissionState" class="grow"><option value="prompt">Prompt</option><option value="granted">Granted</option><option value="denied">Denied</option><option value="blocked">Blocked</option></select></div><button id="applyPermission" style="width:100%;margin-top:8px">Apply permission state</button></div>
<div class="group"><span class="label">Runtime events</span><div class="events" id="events" aria-live="polite"></div><p class="hint">This runs the same development pages, HMR client, provider-neutral HTTP, and Devices contracts as an installed target. Native rendering, signing, push delivery, and OS scheduling still require a simulator or physical device.</p></div>
</aside>
</main>
<script>const config=${boot};const frame=document.getElementById('app');const device=document.getElementById('device');const status=document.getElementById('status');const statusText=document.getElementById('statusText');const events=document.getElementById('events');let platform='ios';const event=(text)=>{const line=document.createElement('div');line.textContent=new Date().toLocaleTimeString()+' · '+text;events.prepend(line)};const routeUrl=()=>{const value=document.getElementById('route').value.trim()||config.entry;const url=new URL(value,location.origin);if(url.origin!==location.origin)throw new TypeError('Preview routes must stay on this dev server.');url.searchParams.set('__absolute_target','mobile-preview');url.searchParams.set('__absolute_preview_platform',platform);return url};const load=()=>{try{status.classList.remove('ready');statusText.textContent='Starting runtime…';frame.src=routeUrl().href;event('loaded '+routeUrl().pathname)}catch(error){statusText.textContent=error.message}};const send=(message)=>{if(!frame.contentWindow)return;frame.contentWindow.postMessage(message,location.origin);event(message.type.replace('absolute-preview:',''))};const select=(ids,active)=>ids.forEach(id=>document.getElementById(id).classList.toggle('active',id===active));document.getElementById('ios').onclick=()=>{platform='ios';device.classList.remove('android');select(['ios','android'],'ios');load()};document.getElementById('android').onclick=()=>{platform='android';device.classList.add('android');select(['ios','android'],'android');load()};document.getElementById('go').onclick=load;document.getElementById('route').onkeydown=e=>{if(e.key==='Enter')load()};document.getElementById('deepLink').onclick=()=>send({type:'absolute-preview:deep-link',url:new URL(document.getElementById('route').value,location.origin).href});document.getElementById('back').onclick=()=>send({type:'absolute-preview:back'});[['online',true,'wifi'],['cellular',true,'cellular'],['offline',false,'none']].forEach(([id,connected,connectionType])=>document.getElementById(id).onclick=()=>{select(['online','cellular','offline'],id);send({type:'absolute-preview:network',connected,connectionType})});['active','background','inactive'].forEach(id=>document.getElementById(id).onclick=()=>{select(['active','background','inactive'],id);send({type:'absolute-preview:lifecycle',state:id})});document.getElementById('keyboardShow').onclick=()=>send({type:'absolute-preview:keyboard',visible:true,heightPx:320});document.getElementById('keyboardHide').onclick=()=>send({type:'absolute-preview:keyboard',visible:false,heightPx:0});document.getElementById('applyPermission').onclick=()=>send({type:'absolute-preview:permission',capability:document.getElementById('permission').value,state:document.getElementById('permissionState').value});addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==frame.contentWindow||!e.data||typeof e.data.type!=='string'||!e.data.type.startsWith('absolute-preview:'))return;if(e.data.type==='absolute-preview:ready'){status.classList.add('ready');statusText.textContent=platform==='ios'?'iOS runtime connected':'Android runtime connected'}event(e.data.event||e.data.type.replace('absolute-preview:',''))});load();</script>
</body>
</html>`;
};

export const createAbsoluteMobilePreviewPlugin = (
	mobile: MobileConfig | undefined
) => {
	if (!mobile)
		return new Elysia({ name: 'absolutejs-mobile-preview-disabled' });

	return new Elysia({ name: 'absolutejs-mobile-preview' })
		.get(
			ABSOLUTE_MOBILE_PREVIEW_PATH,
			() =>
				new Response(absoluteMobilePreviewDocument(mobile), {
					headers: {
						'Cache-Control': 'no-store',
						'Content-Security-Policy':
							"default-src 'self'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline'; frame-src 'self'; img-src 'self' data: blob:; connect-src 'self' ws: wss:",
						'Content-Type': 'text/html; charset=utf-8',
						'X-Robots-Tag': 'noindex, nofollow'
					}
				})
		)
		.post('/__absolute/mobile-preview-telemetry', ({ body, status }) => {
			const value = isRecord(body) ? body : undefined;
			const durationMs = value?.durationMs;
			const platform = value?.platform;
			if (
				typeof durationMs !== 'number' ||
				!Number.isFinite(durationMs) ||
				durationMs < 0 ||
				durationMs > 300_000 ||
				(platform !== 'android' && platform !== 'ios')
			) {
				return status(400, { error: 'invalid-preview-telemetry' });
			}
			sendTelemetryEvent('mobile:preview-ready', {
				durationMs: Math.round(durationMs),
				platform,
				provider: 'capacitor',
				target: 'mobile-preview'
			});

			return status(204);
		});
};
