import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { ReactHome } from "./react/pages/ReactHome";
import {
	handleHTMLPageRequest,
	handleReactPageRequest
} from "../src/core/pageHandlers";
import { build } from "../src/core/build";
import { networkingPlugin } from "../src";

const manifest = await build({
	buildDirectory: "./example/build",
	assetsDirectory: "./example/assets",
	reactDirectory: "./example/react",
	html: {
		directory: "./example/html",
		scriptingOption: "ts+ssr"
	},
	htmxDirectory: "./example/htmx",
	tailwind: {
		input: "./example/styles/tailwind.css",
		output: "/assets/css/tailwind.generated.css"
	}
});

if (manifest === null) throw new Error("Manifest was not generated");

let counter = 0;

export const server = new Elysia()
	.use(
		staticPlugin({
			assets: "./example/build",
			prefix: ""
		})
	)
	.get("/", () =>
		handleHTMLPageRequest("./example/build/html/HtmlHomeIndex.html")
	)
	.get("/react", () =>
		handleReactPageRequest(ReactHome, manifest["ReactHomeIndex"])
	)
	.get("/htmx", () => Bun.file("./example/build/htmx/HtmxHome.html"))
	.get("/htmx/increment", () => {
		counter++;
		return new Response(counter.toString(), {
			headers: { "Content-Type": "text/plain" }
		});
	})
	.use(networkingPlugin)
	.on("error", (error) => {
		const { request } = error;
		console.error(
			`Server error on ${request.method} ${request.url}: ${error.message}`
		);
	});
