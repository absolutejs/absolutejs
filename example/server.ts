import { staticPlugin } from "@elysiajs/static";
import { file } from "bun";
import { Elysia } from "elysia";
import { networkingPlugin } from "../src";
import { build } from "../src/core/build";
import {
	handleHTMLPageRequest,
	handleReactPageRequest
} from "../src/core/pageHandlers";
import { ReactExample } from "./react/pages/ReactExample";

const manifest = await build({
	assetsDirectory: "./example/assets",
	buildDirectory: "./example/build",
	html: {
		directory: "./example/html",
		scriptingOption: "ts+ssr"
	},
	htmxDirectory: "./example/htmx",
	reactDirectory: "./example/react",
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
		handleHTMLPageRequest("./example/build/html/pages/HtmlExample.html")
	)
	.get("/react", () =>
		handleReactPageRequest(ReactExample, manifest["ReactExampleIndex"])
	)
	.get("/htmx", () => file("./example/build/htmx/HtmxHome.html"))
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
