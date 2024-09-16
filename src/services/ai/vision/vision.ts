import { ImageAnnotatorClient } from "@google-cloud/vision";
import credentials from "./credentials.json";
import fetch from 'node-fetch';
import colorName from "color-namer";

const imgAnnotator = new ImageAnnotatorClient({ credentials });

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

// Function to validate if text is a phone number
const isPhoneNumber = (text) => {
    const phonePattern = /(\(\d{3}\)\s?\d{3}-\d{4})|(\d{3}-\d{3}-\d{4})/;
    return phonePattern.test(text);
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

// Function to categorize text into Brand, Disc, or Phone Number
const categorizeText = async (textData) => {
    const { brands, discs } = await fetchBrandsAndDiscs();

    return textData.map((wordData) => {
        const normalizedWord = normalizeWord(wordData.word);
        console.log(`Checking word: ${normalizedWord}`); // Diagnostic log

        if (isPhoneNumber(normalizedWord)) {
            console.log(`${normalizedWord} is a Phone Number`);
            return { ...wordData, category: "Phone Number" };
        } else if (brands.includes(normalizedWord)) {
            console.log(`${normalizedWord} is a Brand`);
            return { ...wordData, category: "Brand" };
        } else if (discs.includes(normalizedWord)) {
            console.log(`${normalizedWord} is a Disc`);
            return { ...wordData, category: "Disc" };
        } else {
            return { ...wordData, category: "N/A" }; // Default category if not matched
        }
    });
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
