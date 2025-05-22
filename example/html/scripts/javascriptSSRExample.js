document.addEventListener("DOMContentLoaded", (event) => {
	const greeting = document.getElementById("greeting");
	const date = new Date();
	const hours = date.getHours();

	if (hours < 12) {
		greeting.textContent = "Good Morning, welcome to AbsoluteJS !";
	} else if (hours < 18) {
		greeting.textContent = "Good Afternoon, welcome to AbsoluteJS !";
	} else {
		greeting.textContent = "Good Evening, welcome to AbsoluteJS !";
	}

	const button = document.getElementById("counter-button");
	const counter = document.getElementById("counter");
	let count = 0;

	button.addEventListener("click", () => {
		count++;
		counter.textContent = count;
	});

	const links = document.querySelectorAll("#links a");
	links.forEach((link) => {
		link.addEventListener("mouseover", () => {
			link.style.transform = "scale(1.2)";
		});
		link.addEventListener("mouseout", () => {
			link.style.transform = "scale(1)";
		});
	});

	const footerText = document.getElementById("footer-text");
	footerText.textContent = `© ${new Date().getFullYear()} AbsoluteJS`;
});
