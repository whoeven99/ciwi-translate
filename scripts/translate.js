import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v2 } from '@google-cloud/translate';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env.worker.test') });
dotenv.config();

const { Translate } = v2;
const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY || process.env.GOOGLE_CLOUD_API_KEY;
if (!apiKey) {
    throw new Error('GOOGLE_TRANSLATE_API_KEY (or GOOGLE_CLOUD_API_KEY) environment variable is not set.');
}
const translateClient = new Translate({ key: apiKey });

async function getLanguageDirs(sourceDir) {
    try {
        const dirs = await fs.readdir(sourceDir, { withFileTypes: true });
        return dirs
            .filter((dirent) => dirent.isDirectory() && dirent.name !== 'en')
            .map((dirent) => dirent.name);
    } catch (error) {
        console.error('Error reading language directories:', error);
        return [];
    }
}

async function translateValue(value, targetLang, sourceLang) {
    if (typeof value === 'string') {
        try {
            const [translation] = await translateClient.translate(value, {
                from: sourceLang,
                to: targetLang,
            });
            return translation;
        } catch (error) {
            console.error(`Error translating value "${value}" to ${targetLang}:`, error);
            return value; // 返回原始值以避免中断
        }
    } else if (typeof value === 'object' && value !== null) {
        const translatedObject = Array.isArray(value) ? [] : {};
        for (const key in value) {
            translatedObject[key] = await translateValue(value[key], targetLang, sourceLang);
        }
        return translatedObject;
    }
    return value; // 非字符串、非对象的值直接返回
}

async function translateFiles(sourceLang, targetLang, sourceDir) {
    const sourcePath = path.join(sourceDir, sourceLang, 'translation.json');
    let sourceData;
    try {
        sourceData = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
    } catch (error) {
        console.error(`Error reading source file ${sourcePath}:`, error);
        return;
    }

    const targetPath = path.join(sourceDir, targetLang, 'translation.json');
    let targetData = {};

    try {
        targetData = JSON.parse(await fs.readFile(targetPath, 'utf8'));
    } catch (e) {
        console.log(`Target file for ${targetLang} not found, creating new.`);
    }

    for (const key in sourceData) {
        if (!targetData[key]) {
            console.log(`Translating "${key}" for ${targetLang}`);
            targetData[key] = await translateValue(sourceData[key], targetLang, sourceLang);
        } else {
            console.log(`Skipping "${key}" for ${targetLang} as it already exists`);
        }
    }

    try {
        await fs.writeFile(targetPath, JSON.stringify(targetData, null, 2));
        console.log(`Translation completed for ${targetLang}`);
    } catch (error) {
        console.error(`Error writing target file ${targetPath}:`, error);
    }
}

async function main() {
    const sourceDir = path.join(__dirname, '../public/locales');
    const sourceLang = 'en';
    const targetLangs = await getLanguageDirs(sourceDir);

    if (targetLangs.length === 0) {
        console.log('No target language directories found in public/locales.');
        return;
    }

    console.log(`Found languages: ${targetLangs.join(', ')}`);

    for (const targetLang of targetLangs) {
        await translateFiles(sourceLang, targetLang, sourceDir);
    }
} 

main().catch(console.error);