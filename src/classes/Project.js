/*
	Project.js
	----------

	The serializable document: the list of wave sources, the editor selection
	and which source feeds the synth. Owns add/remove/select logic and JSON
	(de)serialization. The App holds one Project and exposes its reactive members
	to the windows; runtime-only things (synth, inputs, window manager) stay on
	the App so the document itself stays clean and portable.

	Sources are reconstructed by type through a small registry, so new source
	kinds only need to register their class and a fromJSON.
*/

// vue
import { ref, shallowRef } from "vue";

// wave sources
import GeneratedWave from "@/classes/sources/GeneratedWave.js";
import CustomWave from "@/classes/sources/CustomWave.js";

// bump when the on-disk shape changes incompatibly
export const SCHEMA_VERSION = 1;

// type slug -> source class (must expose static fromJSON)
const SOURCE_TYPES = {
	generated: GeneratedWave,
	custom: CustomWave
};

// main export
export default class Project {

	/**
	 * Creates an empty project.
	 */
	constructor() {
		this.sources = shallowRef([]);
		this.selectedSourceId = ref(null);
		this.soundSourceId = ref(null);
		this.sourceCounter = 0;
	}


	/**
	 * Adds a source of the given type, selects it, and makes it the sound source
	 * if none is set.
	 *
	 * @param {String} [type="generated"] - source kind slug
	 * @returns {Object} the created source
	 */
	addSource(type = "generated") {

		this.sourceCounter++;
		const SourceClass = SOURCE_TYPES[type] || GeneratedWave;
		const source = new SourceClass({ name: `Source ${this.sourceCounter}` });

		this.sources.value = [...this.sources.value, source];
		this.selectedSourceId.value = source.id;

		if (this.soundSourceId.value === null)
			this.soundSourceId.value = source.id;

		return source;
	}


	/**
	 * Removes a source by id, repairing the selection and sound-source bindings.
	 *
	 * @param {String} id - source id
	 * @returns {void}
	 */
	removeSource(id) {

		this.sources.value = this.sources.value.filter((s) => s.id !== id);
		const firstId = this.sources.value.length ? this.sources.value[0].id : null;

		if (this.selectedSourceId.value === id)
			this.selectedSourceId.value = firstId;

		if (this.soundSourceId.value === id)
			this.soundSourceId.value = firstId;
	}


	/**
	 * Sets the editor selection.
	 *
	 * @param {String|null} id - source id, or null
	 * @returns {void}
	 */
	selectSource(id) {
		this.selectedSourceId.value = id;
	}


	/**
	 * Sets which source feeds the synth.
	 *
	 * @param {String|null} id - source id, or null
	 * @returns {void}
	 */
	setSoundSource(id) {
		this.soundSourceId.value = id;
	}


	/**
	 * Looks up a source by id.
	 *
	 * @param {String|null} id - source id
	 * @returns {Object|null}
	 */
	getSource(id) {
		return this.sources.value.find((s) => s.id === id) || null;
	}


	/**
	 * Empties the project.
	 *
	 * @returns {void}
	 */
	clear() {
		this.sources.value = [];
		this.selectedSourceId.value = null;
		this.soundSourceId.value = null;
		this.sourceCounter = 0;
	}


	/**
	 * Serializes the project to a plain object.
	 *
	 * @returns {Object}
	 */
	toJSON() {
		return {
			schemaVersion: SCHEMA_VERSION,
			sourceCounter: this.sourceCounter,
			selectedSourceId: this.selectedSourceId.value,
			soundSourceId: this.soundSourceId.value,
			sources: this.sources.value.map((s) => s.toJSON())
		};
	}


	/**
	 * Replaces the project's contents from serialized data. Unknown source types
	 * are skipped. Ids are preserved so references survive a round-trip.
	 *
	 * @param {Object} data - output of toJSON()
	 * @returns {void}
	 */
	loadJSON(data) {

		if (!data || !Array.isArray(data.sources))
			return;

		const built = [];
		for (const sd of data.sources) {
			const SourceClass = SOURCE_TYPES[sd.type];
			if (SourceClass && typeof SourceClass.fromJSON === "function")
				built.push(SourceClass.fromJSON(sd));
		}

		this.sources.value = built;
		this.sourceCounter = typeof data.sourceCounter === "number" ? data.sourceCounter : built.length;

		const firstId = built.length ? built[0].id : null;
		const hasId = (id) => built.some((s) => s.id === id);

		this.selectedSourceId.value = hasId(data.selectedSourceId) ? data.selectedSourceId : firstId;
		this.soundSourceId.value = hasId(data.soundSourceId) ? data.soundSourceId : firstId;
	}

}
