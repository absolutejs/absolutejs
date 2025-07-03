const button = document.getElementById('counter-button');
const counter = document.getElementById('counter');
let count = 0;

if (button === null || counter === null) {
	throw new Error('Button or counter element not found');
}

button.addEventListener('click', () => {
	count++;
	counter.textContent = count.toString();
});
