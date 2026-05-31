<!--
	PianoKeyboard.vue
	-----------------

	On-screen piano. Renders a configurable range of keys and emits note-on /
	note-off events from pointer interaction, including drag-to-glissando.
	Keys whose midi number is in the activeNotes prop are highlighted, so the
	same component reflects midi and computer-keyboard input too.
-->
<script setup>

// vue
import { computed, ref, onMounted, onBeforeUnmount } from "vue";

// semitone offsets that are white vs black within an octave
const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
const BLACK_OFFSETS = [1, 3, 6, 8, 10];

const props = defineProps({
	// lowest midi note shown
	startNote: { type: Number, default: 48 },
	// number of octaves to render
	octaves: { type: Number, default: 2 },
	// Set of midi note numbers currently sounding
	activeNotes: { type: Object, default: () => new Set() }
});

const emit = defineEmits(["note-on", "note-off"]);

// whether a pointer is currently pressed, for drag-to-play
const isPointerDown = ref(false);

/**
 * Builds the flat list of white keys across the requested range.
 *
 * @returns {Array<{ note:Number, label:String }>}
 */
const whiteKeys = computed(() => {

	const keys = [];

	for (let o = 0; o < props.octaves; o++) {
		for (const offset of WHITE_OFFSETS) {
			const note = props.startNote + o * 12 + offset;
			keys.push({ note, label: offset === 0 ? noteLabel(note) : "" });
		}
	}

	return keys;
});

/**
 * Builds the black keys, each positioned as a percentage across the white-key
 * row so it straddles the gap between two white keys.
 *
 * @returns {Array<{ note:Number, left:Number }>}
 */
const blackKeys = computed(() => {

	const total = whiteKeys.value.length;
	const widthPct = 100 / total;
	const keys = [];
	let whiteIndex = 0;

	for (let o = 0; o < props.octaves; o++) {
		for (let semitone = 0; semitone < 12; semitone++) {

			if (BLACK_OFFSETS.includes(semitone)) {
				// black key sits centered on the right edge of the white key before it
				const note = props.startNote + o * 12 + semitone;
				keys.push({ note, left: whiteIndex * widthPct });
			} else {
				whiteIndex++;
			}
		}
	}

	return keys.map(k => ({ note: k.note, left: k.left }));
});

/**
 * Human-readable note name for a midi number (e.g. 48 -> "C3").
 *
 * @param {Number} midiNote - midi note number
 * @returns {String}
 */
function noteLabel(midiNote) {
	const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
	return names[midiNote % 12] + (Math.floor(midiNote / 12) - 1);
}

/**
 * True when the given midi note is currently sounding.
 *
 * @param {Number} note - midi note number
 * @returns {Boolean}
 */
function isActive(note) {
	return props.activeNotes.has(note);
}

/**
 * Presses a key (pointer down on it, or dragged onto it while pressed).
 *
 * @param {Number} note - midi note number
 * @returns {void}
 */
function press(note) {
	emit("note-on", note, 0.8);
}

/**
 * Releases a key.
 *
 * @param {Number} note - midi note number
 * @returns {void}
 */
function release(note) {
	emit("note-off", note);
}

/**
 * Pointer-down on a key: begin the drag session and press the key.
 *
 * @param {Number} note - midi note number
 * @returns {void}
 */
function onPointerDown(note) {
	isPointerDown.value = true;
	press(note);
}

/**
 * Pointer enters a key while pressed: glissando onto it.
 *
 * @param {Number} note - midi note number
 * @returns {void}
 */
function onPointerEnter(note) {
	if (isPointerDown.value)
		press(note);
}

/**
 * Pointer leaves a key while pressed: release it (so re-entering re-presses).
 *
 * @param {Number} note - midi note number
 * @returns {void}
 */
function onPointerLeave(note) {
	if (isPointerDown.value)
		release(note);
}

/**
 * Ends the drag session on a global pointer-up.
 *
 * @returns {void}
 */
function onGlobalPointerUp() {
	isPointerDown.value = false;
}

onMounted(() => window.addEventListener("pointerup", onGlobalPointerUp));
onBeforeUnmount(() => window.removeEventListener("pointerup", onGlobalPointerUp));

</script>
<template>

	<div class="piano-keyboard" :style="{ '--white-count': whiteKeys.length }">
		<div class="white-row">
			<div
				v-for="key in whiteKeys"
				:key="key.note"
				class="key white"
				:class="{ active: isActive(key.note) }"
				@pointerdown.prevent="onPointerDown(key.note)"
				@pointerenter="onPointerEnter(key.note)"
				@pointerleave="onPointerLeave(key.note)"
				@pointerup="release(key.note)"
			>
				<span v-if="key.label" class="label">{{ key.label }}</span>
			</div>
		</div>

		<div class="black-row">
			<div
				v-for="key in blackKeys"
				:key="key.note"
				class="key black"
				:class="{ active: isActive(key.note) }"
				:style="{ left: key.left + '%' }"
				@pointerdown.prevent="onPointerDown(key.note)"
				@pointerenter="onPointerEnter(key.note)"
				@pointerleave="onPointerLeave(key.note)"
				@pointerup="release(key.note)"
			></div>
		</div>
	</div>

</template>
<style lang="scss" scoped>

	.piano-keyboard {
		position: relative;
		width: 100%;
		height: 160px;
		user-select: none;
		touch-action: none;
	}

	.white-row {
		display: flex;
		height: 100%;
	}

	.key {
		box-sizing: border-box;
		cursor: pointer;
	}

	.white {
		flex: 1 1 0;
		background: #fafafa;
		border: 1px solid #333;
		border-radius: 0 0 4px 4px;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		padding-bottom: 6px;

		&.active {
			background: #6cc4ff;
		}

		.label {
			font-size: 11px;
			color: #888;
			pointer-events: none;
		}
	}

	.black-row {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 60%;
		pointer-events: none;
	}

	.black {
		position: absolute;
		// 60% of a white key wide, nudged left by half its width to straddle the gap
		width: calc(0.6 * (100% / var(--white-count)));
		height: 100%;
		margin-left: calc(-0.3 * (100% / var(--white-count)));
		background: #1b1b1b;
		border: 1px solid #000;
		border-radius: 0 0 3px 3px;
		pointer-events: auto;

		&.active {
			background: #2f7fb0;
		}
	}

</style>
