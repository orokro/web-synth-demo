/*
	main.js
	-------

	Application entry point. Loads the global icon font (Material Symbols,
	bundled locally — no CDN) and mounts the root App component.
*/

// vue
import { createApp } from "vue";

// global icon font (bundled, works offline / forever)
import "material-symbols/outlined.css";

// root component
import App from "./App.vue";

createApp(App).mount("#app");
