export const ssrErrorPage = (framework: string, error: unknown): string => {
	const frameworkColors: Record<string, string> = {
		angular: '#dd0031',
		html: '#e34c26',
		htmx: '#1a365d',
		react: '#61dafb',
		svelte: '#ff3e00',
		vue: '#42b883'
	};

	const accent = frameworkColors[framework] ?? '#94a3b8';
	const label = framework.charAt(0).toUpperCase() + framework.slice(1);
	const message = error instanceof Error ? error.message : String(error);

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SSR Error - AbsoluteJS</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;background:linear-gradient(135deg,rgba(15,23,42,0.98) 0%,rgba(30,41,59,0.98) 100%);color:#e2e8f0;font-family:"JetBrains Mono","Fira Code",ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:14px;line-height:1.6;display:flex;align-items:flex-start;justify-content:center;padding:32px}
.card{max-width:720px;width:100%;background:rgba(30,41,59,0.6);border:1px solid rgba(71,85,105,0.5);border-radius:16px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5),0 0 0 1px rgba(255,255,255,0.05);overflow:hidden}
.header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 24px;background:rgba(15,23,42,0.5);border-bottom:1px solid rgba(71,85,105,0.4)}
.brand{font-weight:700;font-size:20px;color:#fff;letter-spacing:-0.02em}
.badge{padding:5px 10px;border-radius:8px;font-size:12px;font-weight:600;background:${accent};color:#fff;opacity:0.95;box-shadow:0 2px 4px rgba(0,0,0,0.2)}
.kind{color:#94a3b8;font-size:13px;font-weight:500}
.content{padding:24px}
.label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:8px}
.message{margin:0;padding:16px 20px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.25);border-radius:10px;overflow-x:auto;white-space:pre-wrap;word-break:break-word;color:#fca5a5;font-size:13px;line-height:1.5}
.hint{margin-top:20px;padding:12px 20px;background:rgba(71,85,105,0.3);border-radius:10px;border:1px solid rgba(71,85,105,0.4);color:#cbd5e1;font-size:13px}
</style>
</head>
<body>
<div class="card">
<div class="header">
<div style="display:flex;align-items:center;gap:12px">
<span class="brand">AbsoluteJS</span>
<span class="badge">${label}</span>
</div>
<span class="kind">Server Render Error</span>
</div>
<div class="content">
<div class="label">What went wrong</div>
<pre class="message">${message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
<div class="hint">A component threw during server-side rendering. Check the terminal for the full stack trace.</div>
</div>
</div>
</body>
</html>`;
};
