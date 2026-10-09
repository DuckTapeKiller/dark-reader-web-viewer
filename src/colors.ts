export interface ColorFilter {
	brightness: number;
	contrast: number;
	sepia: number;
}

type Vector = [number, number, number];
type Matrix = [Vector, Vector, Vector];

// Dark Reader's sepia matrix (src/generators/utils/matrix.ts).
function sepiaMatrix(amount: number): Matrix {
	const rest = 1 - amount;
	return [
		[0.393 + 0.607 * rest, 0.769 - 0.769 * rest, 0.189 - 0.189 * rest],
		[0.349 - 0.349 * rest, 0.686 + 0.314 * rest, 0.168 - 0.168 * rest],
		[0.272 - 0.272 * rest, 0.534 - 0.534 * rest, 0.131 + 0.869 * rest],
	];
}

function solve(matrix: Matrix, target: Vector): Vector | undefined {
	const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
	const determinant =
		a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
	if (Math.abs(determinant) < 1e-9) {
		return undefined;
	}
	const inverse: Matrix = [
		[e * i - f * h, c * h - b * i, b * f - c * e],
		[f * g - d * i, a * i - c * g, c * d - a * f],
		[d * h - e * g, b * g - a * h, a * e - b * d],
	];
	return inverse.map(
		(row) =>
			(row[0] * target[0] + row[1] * target[1] + row[2] * target[2]) /
			determinant,
	) as Vector;
}

function parseHex(hex: string): Vector | undefined {
	const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
	if (!match) {
		return undefined;
	}
	return [1, 2, 3].map(
		(index) => Number.parseInt(match[index] ?? '0', 16) / 255,
	) as Vector;
}

export function toHex(channels: readonly number[]): string {
	return `#${channels
		.map((channel) =>
			Math.round(Math.min(Math.max(channel, 0), 1) * 255)
				.toString(16)
				.padStart(2, '0'),
		)
		.join('')}`;
}

/**
 * Dark Reader turns a page's white background and black text into exactly its
 * scheme colors, then runs every color through its sepia, contrast and
 * brightness filter. Returns the scheme color that the filter turns into
 * `hex`, so the page's base colors come out as Obsidian's own. Values the
 * filter cannot reach are clamped.
 */
export function unfilterColor(hex: string, filter: ColorFilter): string {
	const target = parseHex(hex);
	if (!target) {
		return hex;
	}

	// The filter applies brightness, then contrast, then sepia. Undo them in
	// reverse order.
	let color: Vector = target;
	if (filter.sepia !== 0) {
		color = solve(sepiaMatrix(filter.sepia / 100), color) ?? color;
	}
	if (filter.contrast !== 100) {
		const contrast = filter.contrast / 100;
		const offset = (1 - contrast) / 2;
		color = color.map((channel) => (channel - offset) / contrast) as Vector;
	}
	if (filter.brightness !== 100) {
		const brightness = filter.brightness / 100;
		color = color.map((channel) => channel / brightness) as Vector;
	}
	return toHex(color);
}

/**
 * Below 100% contrast Dark Reader's filter cannot produce pure white (or, with
 * sepia, some other colors) whatever it is given, so a theme's own colors can be
 * out of reach. Returns the filter with brightness raised just enough to reach
 * every target. The user's brightness still scales on top of that.
 */
export function reachableFilter(
	filter: ColorFilter,
	targets: readonly string[],
): ColorFilter {
	const contrast = filter.contrast / 100;
	const offset = (1 - contrast) / 2;
	let needed = 1;
	for (const hex of targets) {
		let color = parseHex(hex);
		if (!color) {
			continue;
		}
		if (filter.sepia !== 0) {
			color = solve(sepiaMatrix(filter.sepia / 100), color) ?? color;
		}
		for (const channel of color) {
			needed = Math.max(needed, (channel - offset) / contrast);
		}
	}
	return {
		...filter,
		brightness: filter.brightness * Math.min(needed, 2),
	};
}

/** Splits a CSS font-family list, keeping quoted names intact. */
export function splitFontFamilies(value: string): string[] {
	const families: string[] = [];
	let current = '';
	let quote = '';
	for (const character of value) {
		if (quote) {
			current += character;
			if (character === quote) {
				quote = '';
			}
		} else if (character === '"' || character === "'") {
			quote = character;
			current += character;
		} else if (character === ',') {
			families.push(current.trim());
			current = '';
		} else {
			current += character;
		}
	}
	families.push(current.trim());
	return families.filter((family) => family.length > 0);
}

export function unquoteFontFamily(family: string): string {
	return family.replace(/^(['"])(.*)\1$/, '$2').trim().toLowerCase();
}
