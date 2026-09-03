import path from "path";
import fs from "fs";
import subsetFont from "subset-font";
import { Font } from "fonteditor-core";
import { getFontPartCharSets } from "../read-font-file/readFontBuffer.js";
import { logger } from "../logger.js";
const __dirname = import.meta.dirname;

function sfntType(buffer) {
	return buffer.toString("latin1", 0, 4) === "OTTO" ? "otf" : "ttf";
}

// Merge the requested glyphs of several split files into one sfnt.
// Each part is subset first so fonteditor-core only parses a handful of glyphs.
async function mergeFontParts(selected) {
	let merged = null;
	for (const { part, words } of selected) {
		const sfnt = await subsetFont(fs.readFileSync(part.fullPath), words, {
			targetFormat: "truetype",
		});
		const font = Font.create(sfnt, {
			type: sfntType(sfnt),
			hinting: false,
			compound2simple: true,
		});
		if (!merged) {
			merged = font;
			continue;
		}
		const scale =
			merged.get().head.unitsPerEm / font.get().head.unitsPerEm || 1;
		merged.merge(font, { scale, adjustGlyf: false });
	}
	return merged.write({ type: "ttf", hinting: false, toBuffer: true });
}

// Pick the sfnt to subset from. Single-file weights are returned untouched;
// split weights only merge the parts that actually own requested glyphs.
async function loadSubsetSource(originalFontFamily, font_weight, words) {
	const parts = getFontPartCharSets(originalFontFamily, font_weight);
	if (parts.length === 0) return { success: false };
	if (parts.length === 1) {
		return { success: true, fontfile: fs.readFileSync(parts[0].fullPath) };
	}
	const needed = new Set(Array.from(words, char => char.codePointAt(0)));
	const selected = [];
	for (const part of parts) {
		const owned = [];
		for (const cp of needed) {
			if (part.codePoints.has(cp)) {
				owned.push(cp);
				needed.delete(cp);
			}
		}
		if (owned.length > 0) {
			selected.push({
				part,
				words: owned.map(cp => String.fromCodePoint(cp)).join(""),
			});
		}
	}
	// No part owns any requested glyph: keep the old behaviour of emitting an empty subset.
	if (selected.length === 0) {
		return { success: true, fontfile: fs.readFileSync(parts[0].fullPath) };
	}
	if (selected.length === 1) {
		return { success: true, fontfile: fs.readFileSync(selected[0].part.fullPath) };
	}
	return { success: true, fontfile: await mergeFontParts(selected) };
}

// generateFont: geneerate subset font and save to disk.
async function generateFont(
	originalFontFamily,
	font_weight,
	words,
	output_name,
	put_folder = "../../_data/_generated", //default
	fontfile = null,
) {
	try {
		// 如果沒提供 buffer，就讀取字型檔
		let success = true;
		if (!fontfile) {
			({ fontfile, success } = await loadSubsetSource(
				originalFontFamily,
				font_weight,
				words,
			));
		}
		if (!success) {
			return {
				status: "failed",
				message: "emfont can't read original font, please try again later.",
				location: "null",
			};
		}
		// // 確保資料夾存在
		const destFolder = path.join(__dirname, put_folder);
		await fs.promises.mkdir(destFolder, { recursive: true });

		// It is possible to generate a file without any fonts, which happens when the original font file doesn't support any of the requested fonts
		// The users's browser will report an error if it reads it empty file.
		// 可能生成不包含任何 glyphs 的檔案，這會發生在原始字型檔不支援任何請求的字型時，使用者的瀏覽器在讀取到空檔案時會報錯，但是這是正常行為。

		// I don't intend to do any checking, because the time cost of preventing this is much greater than the time it takes to request an empty file.

		const outputPath = path.join(destFolder, `${output_name}`);
		const resultBuffer = await subsetFont(fontfile, words, {
			targetFormat: "woff2",

			// output: path.join(destFolder, output_name), // Set custom output file path
		});
		await fs.promises.writeFile(outputPath, resultBuffer);

		logger.debug(
			`sub font generate successfuly: ${output_name} (${words.length} glyphs)`,
		);
		return {
			status: "success",
			location: `${output_name}`,
		};
	} catch (err) {
		logger.error(`sub font generate failed: ${output_name} (${err.message})`);
		return {
			status: "failed",
			message: "emfont can't read original font, please try again later.",
			location: "null",
		};
	}
}
export { generateFont };
