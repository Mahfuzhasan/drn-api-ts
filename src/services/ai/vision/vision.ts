import { ImageAnnotatorClient } from "@google-cloud/vision";
import credentials from "./credentials.json";
import fetch from 'node-fetch';
import colorName from "color-namer";
import stringSimilarity from 'string-similarity';  // Import for fuzzy matching

const imgAnnotator = new ImageAnnotatorClient({ credentials });

// Corrected confused character map for common OCR errors
const confusedCharacterMap = {
    'l': 'i',  // 'l' and 'i' confusion
    '0': 'O',  // '0' and 'O' confusion
    '1': 'l',  // '1' and 'l' confusion
    '5': 'S',  // '5' and 'S' confusion
    '8': 'B',  // '8' and 'B' confusion
    '2': 'Z',  // '2' and 'Z' confusion
    '6': 'G',  // '6' and 'G' confusion
    '9': 'g',  // '9' and 'g' confusion
    '3': 'E',  // '3' and 'E' confusion
    '4': 'A',  // '4' and 'A' confusion
    '7': 'T',  // '7' and 'T' confusion
    'C': 'G',  // 'C' and 'G' confusion
    'D': 'O',  // 'D' and 'O' confusion
    'K': 'X',  // 'K' and 'X' confusion
    'P': 'R',  // 'P' and 'R' confusion
    'Q': 'O',  // 'Q' and 'O' confusion

    // Special characters
    '!': '1',  // '!' and '1' confusion
    '|': 'I',  // '|' and 'I' confusion
    '$': '5',  // '$' and '5' confusion
    '@': 'a',  // '@' and 'a' confusion
    '%': '5',  // '%' and '5' confusion
    '&': '8',  // '&' and '8' confusion
    '(': 'C',  // '(' and 'C' confusion
    ')': 'D',  // ')' and 'D' confusion

    // Uppercase-lowercase confusion
    'I': '1',  // 'I' and '1' confusion
    'Z': 'S',  // 'Z' and 'S' confusion
    'V': 'U',  // 'V' and 'U' confusion
};

// Function to dynamically replace confused characters
const correctCommonOcrMistakes = (word) => {
    return word.split('').map(char => confusedCharacterMap[char] || char).join('');
};

// Function to map color to primary color
const mapToPrimaryColor = (color) => {
    const primaryColors = {
        red: ["red", "crimson", "maroon"],
        blue: ["blue", "navy", "sky"],
        yellow: ["yellow", "gold", "amber"],
    };
    for (const [primary, shades] of Object.entries(primaryColors)) {
        if (shades.some(shade => color.toLowerCase().includes(shade))) {
            return primary.charAt(0).toUpperCase() + primary.slice(1);
        }
    }
    return "Unknown";
};

// Function to validate if a combined text is a phone number
const isPhoneNumber = (combinedText) => {
    const phonePattern = /^1?\s?(\d{3})[-\s]?(\d{3})[-\s]?(\d{4})$/; // Handles optional '1', spaces, and dashes
    return phonePattern.test(combinedText);
};

// Fetch brands and discs data from the API
const fetchBrandsAndDiscs = async () => {
    try {
        const brandsResponse = await fetch('https://drn-api-v2.discrescuenetwork.com/brands');
        const discsResponse = await fetch('https://drn-api-v2.discrescuenetwork.com/discs');

        const brandsData = await brandsResponse.json();
        const discsData = await discsResponse.json();

        const brands = brandsData.data.map(brand => brand.attributes.BrandName.toLowerCase());
        const discs = discsData.data.map(disc => disc.attributes.MoldName.toLowerCase());

        return { brands, discs };
    } catch (error) {
        console.error('Error fetching brands and discs:', error);
        return { brands: [], discs: [] };
    }
};

// Normalize word (trim, lowercase, remove special characters except dots)
const normalizeWord = (word) => {
    return word.trim().toLowerCase().replace(/[^a-z0-9.]/gi, '');
};

// Function to perform fuzzy matching
const findClosestMatch = (word, wordList) => {
    // Apply character substitution for common OCR mistakes
    const correctedWord = correctCommonOcrMistakes(word);

    const matches = stringSimilarity.findBestMatch(correctedWord, wordList);
    if (matches.bestMatch.rating >= 0.75) { // Set threshold for fuzzy matching
        return matches.bestMatch.target;
    }
    return null;
};

// Function to categorize text into Brand, Disc, or Phone Number
const categorizeText = async (textData) => {
    const { brands, discs } = await fetchBrandsAndDiscs();

    let combinedNumber = "";
    let categorizedWords = [];

    for (let i = 0; i < textData.length; i++) {
        const wordData = textData[i];
        const normalizedWord = normalizeWord(wordData.word);
        console.log(`Checking word: ${normalizedWord}`); // Diagnostic log

        // If the word contains only digits, append it to combinedNumber
        if (/^\d+$/.test(normalizedWord)) {
            combinedNumber += normalizedWord;
            console.log(`Accumulated number: ${combinedNumber}`);

            // If the combined number looks like a phone number, categorize it
            if (isPhoneNumber(combinedNumber)) {
                console.log(`${combinedNumber} is a Phone Number`);
                categorizedWords.push({ ...wordData, word: combinedNumber, category: "Phone Number" });
                combinedNumber = ""; // Reset for the next possible phone number
            }
        } else {
            // If combinedNumber has accumulated and is a valid phone number, add it to results
            if (combinedNumber && isPhoneNumber(combinedNumber)) {
                categorizedWords.push({ word: combinedNumber, category: "Phone Number" });
                combinedNumber = ""; // Reset for the next possible phone number
            }

            // Perform fuzzy matching on brands and discs
            const closestBrand = findClosestMatch(normalizedWord, brands);
            const closestDisc = findClosestMatch(normalizedWord, discs);

            if (closestBrand) {
                console.log(`${normalizedWord} is fuzzy matched to Brand: ${closestBrand}`);
                categorizedWords.push({ ...wordData, word: closestBrand, category: "Brand" });
            } else if (closestDisc) {
                console.log(`${normalizedWord} is fuzzy matched to Disc: ${closestDisc}`);
                categorizedWords.push({ ...wordData, word: closestDisc, category: "Disc" });
            } else {
                categorizedWords.push({ ...wordData, category: "N/A" });
            }
        }
    }

    // If there's still an unprocessed combined number at the end, check it
    if (combinedNumber && isPhoneNumber(combinedNumber)) {
        categorizedWords.push({ word: combinedNumber, category: "Phone Number" });
    }

    return categorizedWords;
};

// Main function to process the image
const getImageText = async (img) => {
    try {
        const req = {
            image: {
                content: Buffer.from(img, "base64"),
            },
            features: [
                { type: "IMAGE_PROPERTIES" },
                { type: "DOCUMENT_TEXT_DETECTION" },
            ],
        };
        const imgData = await imgAnnotator.annotateImage(req);

        const textConfidence = imgData[0].fullTextAnnotation.pages[0].confidence;
        const words = imgData[0].fullTextAnnotation.pages[0].blocks.flatMap(block =>
            block.paragraphs.flatMap(paragraph =>
                paragraph.words.map(wordObj => ({
                    confidence: wordObj.confidence,
                    word: wordObj.symbols.map(symbol => symbol.text).join(""),
                    category: "N/A" // Initial default
                }))
            )
        );

        const categorizedWords = await categorizeText(words);

        const detectedColor = imgData[0].imagePropertiesAnnotation.dominantColors.colors[0];
        const colorNameResult = colorName(`rgb(${detectedColor.color.red}, ${detectedColor.color.green}, ${detectedColor.color.blue})`);
        const primaryColor = mapToPrimaryColor(colorNameResult.basic[0].name);

        const data = {
            text: {
                confidence: textConfidence,
                words: categorizedWords
            },
            colors: [{  // Ensure colors is an array as per API spec
                primary: primaryColor !== "Unknown" ? primaryColor : colorNameResult.basic[0].name,
                score: detectedColor.score
            }]
        };

        return { data };

    } catch (error) {
        console.error("Error processing image:", error);
        return { errors: [error.message] };
    }
};

export default { getImageText };
