import { HOURS_IN_DAY, TWO_THIRDS } from "../../../src/constants";

document.addEventListener("DOMContentLoaded", () => {
	const greeting = document.getElementById("greeting");
	const date = new Date();
	const hours = date.getHours();

	if (greeting === null) {
		throw new Error("Greeting element not found");
	}

	if (hours < HOURS_IN_DAY / 2) {
		greeting.textContent = "Good Morning, welcome to AbsoluteJS !";
	} else if (hours < HOURS_IN_DAY * TWO_THIRDS) {
		greeting.textContent = "Good Afternoon, welcome to AbsoluteJS !";
	} else {
		greeting.textContent = "Good Evening, welcome to AbsoluteJS !";
	}

	const button = document.getElementById("counter-button");
	const counter = document.getElementById("counter");
	let count = 0;

	if (button === null || counter === null) {
		throw new Error("Button or counter element not found");
	}

	button.addEventListener("click", () => {
		count++;
		counter.textContent = count.toString();
	});

	const links = document.querySelectorAll<HTMLAnchorElement>("#links a");
	links.forEach((link) => {
		link.addEventListener("mouseover", () => {
			link.style.transform = "scale(1.2)";
		});
		link.addEventListener("mouseout", () => {
			link.style.transform = "scale(1)";
		});
	});

	const footerText = document.getElementById("footer-text");

	if (footerText === null) {
		throw new Error("Footer text element not found");
	}

	footerText.textContent = `© ${new Date().getFullYear()} AbsoluteJS`;
});
