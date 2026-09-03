//讀字型檔案，放入緩衝區
import path from "path";
import * as fontkit from "fontkit";
import fs from "fs";
const __dirname = import.meta.dirname;
const __Font_storge_path_base = path.join(__dirname, "../../", "_data", "original-fonts"); //projectroot/src/_data/original-fonts/

// One weight may be split into several files when the glyph count exceeds the
// 65535 sfnt limit (e.g. 全字庫 TW-Kai + Ext-B + Plus). The primary file is
// `<weight>.<ext>`; extra parts are `<weight>-<n>.<ext>` with n >= 1.
const FONT_FILE_RE = /^(\d+)(?:-(\d+))?\.(ttf|otf)$/i;
const FONT_EXTENSIONS = ["ttf", "otf"];

function fontFileName(weight, part = 0, extension = "ttf") {
    return part > 0 ? `${weight}-${part}.${extension}` : `${weight}.${extension}`;
}

function parseFontFileName(fileName) {
    const match = fileName.match(FONT_FILE_RE);
    if (!match) return null;
    return {
        weight: Number(match[1]),
        part: match[2] ? Number(match[2]) : 0,
        extension: match[3].toLowerCase(),
    };
}

// Every file belonging to a weight, ordered by part index. ttf wins over otf for the same part.
function listFontPartFiles(originalFontFamily, font_weight) {
    const dir = path.join(__Font_storge_path_base, originalFontFamily);
    if (!fs.existsSync(dir)) return [];
    const byPart = new Map();
    for (const name of fs.readdirSync(dir)) {
        const parsed = parseFontFileName(name);
        if (!parsed || parsed.weight !== Number(font_weight)) continue;
        const existing = byPart.get(parsed.part);
        if (existing && FONT_EXTENSIONS.indexOf(existing.type) <= FONT_EXTENSIONS.indexOf(parsed.extension)) continue;
        byPart.set(parsed.part, { part: parsed.part, type: parsed.extension, fullPath: path.join(dir, name) });
    }
    return Array.from(byPart.values()).sort((a, b) => a.part - b.part);
}

/**
 * 讀取字型檔案
 * @param {string} originalFontFamily 字型資料夾名稱
 * @param {string} font_weight 字重檔名（不含副檔名）
 * @param {boolean} use_fontkit 是否使用 fontkit 解析
 * @returns {Promise<{success: boolean, fontfile?: Buffer|object, type?: string, parts?: Array<{part: number, type: string, fullPath: string, fontfile: Buffer|object}>}>}
 */
async function readFontBuffer(originalFontFamily, font_weight, use_fontkit = false) {
    const files = listFontPartFiles(originalFontFamily, font_weight);
    if (files.length === 0) {
        console.error("找不到字體:", path.join(__Font_storge_path_base, originalFontFamily, `${font_weight}.ttf`));
        return { success: false };
    }
    const parts = files.map(file => ({
        ...file,
        fontfile: use_fontkit ? fontkit.openSync(file.fullPath) : fs.readFileSync(file.fullPath),
    }));
    // fontfile/type keep the single-file shape for existing callers; parts carries every split file.
    return { fontfile: parts[0].fontfile, type: parts[0].type, parts, success: true };
}

// Cache of per-part code point sets, invalidated when any part file changes on disk.
const partCharSetCache = new Map();

function partsSignature(files) {
    return files
        .map(({ fullPath }) => {
            const stat = fs.statSync(fullPath);
            return `${fullPath}:${stat.size}:${stat.mtimeMs}`;
        })
        .join("|");
}

/**
 * 取得每個分割檔支援的碼位
 * @returns {Array<{part: number, type: string, fullPath: string, codePoints: Set<number>}>} 找不到字型時為空陣列
 */
function getFontPartCharSets(originalFontFamily, font_weight) {
    const files = listFontPartFiles(originalFontFamily, font_weight);
    if (files.length === 0) return [];
    const cacheKey = `${originalFontFamily}/${font_weight}`;
    const signature = partsSignature(files);
    const cached = partCharSetCache.get(cacheKey);
    if (cached && cached.signature === signature) return cached.parts;
    const parts = files.map(file => ({
        ...file,
        codePoints: new Set(fontkit.openSync(file.fullPath).characterSet),
    }));
    partCharSetCache.set(cacheKey, { signature, parts });
    return parts;
}

/**
 * 取得該字重所有分割檔支援字元的聯集
 * @returns {string[]|null} 找不到字型時為 null
 */
function getSupportedChars(originalFontFamily, font_weight) {
    const parts = getFontPartCharSets(originalFontFamily, font_weight);
    if (parts.length === 0) return null;
    const codePoints = new Set();
    for (const { codePoints: partCodePoints } of parts) {
        for (const cp of partCodePoints) codePoints.add(cp);
    }
    return Array.from(codePoints)
        .map(cp => String.fromCodePoint(cp))
        .filter(char => char !== "\x00");
}

export {
    readFontBuffer,
    listFontPartFiles,
    getFontPartCharSets,
    getSupportedChars,
    fontFileName,
    parseFontFileName,
    FONT_FILE_RE,
    FONT_EXTENSIONS,
};
