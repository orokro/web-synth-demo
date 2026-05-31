/*
	Project.js
	----------

	The serializable document: the list of wave sources, the editor selection
	and which source feeds the synth. Owns add/remove/select logic, JSON
	(de)serialization, and the reference-cycle prevention used by combining and
	morphing source types.

	Sources are reconstructed by type through a small registry. Every source gets
	a `resolve(id)` lookup bound to this project so referencing types can read
	their inputs by id (references, never clones).
*/

// vue
import { ref, shallowRef } from "vue";

// wave sources
import GeneratedWave from "@/classes/sources/GeneratedWave.js";
import CustomWave from "@/classes/sources/CustomWave.js";
import CombinedWave from "@/classes/sources/CombinedWave.js";
import ShapedWave from "@/classes/sources/ShapedWave.js";

// bump when the on-disk shape changes incompatibly
export const SCHEMA_VERSION = 1;

// type slug -> source class (must expose static fromJSON)
const SOURCE_TYPES = {
	generated: GeneratedWave,
	custom: CustomWave,
	combined: CombinedWave,
	shaped: ShapedWave
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
	 * Binds the project's id->source resolver onto a source, so referencing
	 * types can look up their inputs.
	 *
	 * @param {WaveSource} source - the source
	 * @returns {WaveSource}
	 */
	bindResolver(source) {
		source.resolve = (id) => this.getSource(id);
		return source;
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
		const source = this.bindResolver(new SourceClass({ name: `Source ${this.sourceCounter}` }));

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
	 * True if `targetId` is reachable from `startId` by following dependencies.
	 *
	 * @param {String} startId - source to start from
	 * @param {String} targetId - source to look for
	 * @param {Set<String>} [visited] - cycle guard
	 * @returns {Boolean}
	 */
	hasPath(startId, targetId, visited = new Set()) {
		if (startId === targetId)
			return true;
		if (visited.has(startId))
			return false;
		visited.add(startId);
		const src = this.getSource(startId);
		if (!src)
			return false;
		for (const dep of src.getDependencies())
			if (this.hasPath(dep, targetId, visited))
				return true;
		return false;
	}


	/**
	 * True if making `fromId` reference `toId` would create a cycle (including
	 * a self-reference).
	 *
	 * @param {String} fromId - the referencing source
	 * @param {String} toId - the prospective input
	 * @returns {Boolean}
	 */
	wouldCreateCycle(fromId, toId) {
		return fromId === toId || this.hasPath(toId, fromId);
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
				built.push(this.bindResolver(SourceClass.fromJSON(sd)));
		}

		this.sources.value = built;
		this.sourceCounter = typeof data.sourceCounter === "number" ? data.sourceCounter : built.length;

		const firstId = built.length ? built[0].id : null;
		const hasId = (id) => built.some((s) => s.id === id);

		this.selectedSourceId.value = hasId(data.selectedSourceId) ? data.selectedSourceId : firstId;
		this.soundSourceId.value = hasId(data.soundSourceId) ? data.soundSourceId : firstId;
	}

}
