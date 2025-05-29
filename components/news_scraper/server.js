const axios = require("axios");
const cheerio = require("cheerio");
const { URL } = require("url");
const NodeCache = require("node-cache");
const rateLimit = require("axios-rate-limit");
const { storeArticles, articleExists } = require("../firebase_store/server");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize cache with 1 hour TTL
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

const CONFIG = {
  BASE_URL: "https://onlinekhabar.com/",
  TARGET_SELECTOR: "section.ok-bises.ok-bises-default",
  // TARGET_SELECTOR: "section.ok-bises.ok-bises-type-2",
  MAX_RETRIES: 3,
  TIMEOUT: 10000,
  RATE_LIMIT: 5,
  GEMINI_API_KEY: "AIzaSyBsQnaUc2IwbtUIQa9maEQ5jGU0BZD1oXc",
  USER_AGENTS: [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1",
  ],
};

const http = rateLimit(axios.create(), {
  maxRequests: CONFIG.RATE_LIMIT,
  perMilliseconds: 1000,
});

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_API_KEY);

const getRandomUserAgent = () => {
  return CONFIG.USER_AGENTS[
    Math.floor(Math.random() * CONFIG.USER_AGENTS.length)
  ];
};

const isValidUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch (err) {
    return false;
  }
};

const fetchHtml = async (url, retries = CONFIG.MAX_RETRIES) => {
  const cacheKey = `html_${url}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log("Returning cached HTML");
    return cached;
  }

  try {
    const response = await http.get(url, {
      timeout: CONFIG.TIMEOUT,
      headers: {
        "User-Agent": getRandomUserAgent(),
        "Accept-Language": "en-US,en;q=0.9,ne;q=0.8",
      },
    });

    if (response.status !== 200) {
      throw new Error(`Request failed with status code ${response.status}`);
    }

    // Cache the response
    cache.set(cacheKey, response.data);
    return response.data;
  } catch (error) {
    if (retries > 0) {
      console.warn(
        `Retrying (${CONFIG.MAX_RETRIES - retries + 1}/${
          CONFIG.MAX_RETRIES
        })...`
      );
      await new Promise((resolve) =>
        setTimeout(resolve, 1000 * (CONFIG.MAX_RETRIES - retries + 1))
      );
      return fetchHtml(url, retries - 1);
    }
    throw new Error(
      `Failed to fetch HTML after ${CONFIG.MAX_RETRIES} attempts: ${error.message}`
    );
  }
};

const extractArticles = (html) => {
  try {
    const $ = cheerio.load(html);
    const articles = [];

    $(CONFIG.TARGET_SELECTOR).each((index, element) => {
      try {
        const titleElement = $(element).find("h2 a");
        const title = titleElement.text().trim();
        const relativeLink = titleElement.attr("href");

        if (!title || !relativeLink) {
          console.warn("Missing title or link in article element");
          return;
        }

        // Construct absolute URL
        const absoluteLink = isValidUrl(relativeLink)
          ? relativeLink
          : new URL(relativeLink, CONFIG.BASE_URL).href;

        articles.push({
          title,
          link: absoluteLink,
        });
      } catch (error) {
        console.error(`Error processing article ${index}: ${error.message}`);
      }
    });

    return articles;
  } catch (error) {
    console.error(`Error extracting articles: ${error.message}`);
    throw error;
  }
};

const normalizeUrl = (url) => {
  const u = new URL(url);
  u.searchParams.forEach((_, key) => {
    if (
      key.startsWith("utm_") ||
      key.startsWith("fbclid") ||
      key.startsWith("gclid")
    ) {
      u.searchParams.delete(key);
    }
  });
  return u.toString().replace(/\/$/, "");
};

const paraphraseWithGemini = async (title, content, maxRetries = 3) => {
  const cacheKey = `gemini_${title}_${content.substring(0, 50)}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log("Returning cached Gemini response");
    return cached;
  }

  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = `
  Please perform the following tasks for this news article:

  1. Paraphrase and translate the content into natural, fluent Nepali (under 60 words)
  2. Atleast 7 english hashtags array based on news contents, lowercase
  3. Generate 5 detailed image prompts that could illustrate different aspects of this news story

  Article Title: ${title}
  Article Content: ${content.substring(0, 4000)}

  Return the results strictly in this exact JSON format:
  {
    "paraphrased_title": "Paraphrased Nepali title here",
    "paraphrased_content": "Paraphrased Nepali content here (under 60 words)",
    "captions": ["#nepal", "#news", "#nepalinews"],
    "image_prompts": [
      {
        "prompt": "Detailed prompt for image 1 in English",
        "aspect": "What aspect of story this represents"
      },
      {
        "prompt": "Detailed prompt for image 2 in English",
        "aspect": "What aspect of story this represents"
      },
      {
        "prompt": "Detailed prompt for image 3 in English",
        "aspect": "What aspect of story this represents"
      },
      {
        "prompt": "Detailed prompt for image 4 in English",
        "aspect": "What aspect of story this represents"
      },
      {
        "prompt": "Detailed prompt for image 5 in English",
        "aspect": "What aspect of story this represents"
      }
    ]
  }

  Strict Guidelines:
  1. Image prompts must be:
     - In English
     - Highly detailed (50-100 words each)
     - Photorealistic style
     - Strictly in 9:16 aspect ratio
     - Use correct Nepali flag and police custume whereever needed
     - Safe for all audiences (no weapons, violence, etc.)
     - Culturally appropriate for Nepali context
     - Each representing different aspects of the story
  2. Content must be:
     - Accurate to original facts
     - Under 300 words
     - Fluent Nepali
  3. All names, dates and numbers must be preserved exactly
  4. Output must be valid JSON
  `;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      // Enhanced JSON parsing with error details
      try {
        const jsonStart = text.indexOf("{");
        const jsonEnd = text.lastIndexOf("}") + 1;
        const jsonString = text.slice(jsonStart, jsonEnd);
        const parsedData = JSON.parse(jsonString);

        // Validate the response structure
        if (
          !parsedData.paraphrased_title ||
          !parsedData.paraphrased_content ||
          !parsedData.image_prompts ||
          parsedData.image_prompts.length !== 5
        ) {
          throw new Error("Incomplete data from Gemini");
        }

        cache.set(cacheKey, parsedData);

        return parsedData;
      } catch (parseError) {
        console.error("JSON parsing failed:", parseError.message);
        throw new Error(`Invalid JSON from Gemini: ${parseError.message}`);
      }
    } catch (error) {
      console.warn(`Attempt ${attempt} failed: ${error.message}`);
      if (attempt === maxRetries) {
        console.error("Gemini processing failed after multiple attempts");
        return {
          paraphrased_title: title,
          paraphrased_content: content,
          image_prompts: Array(5).fill({
            prompt: "No prompt generated due to error",
            aspect: "N/A",
          }),
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt)); // Exponential backoff
    }
  }
};

const scrapeNews = async (maxArticles = 5) => {
  try {
    console.log("Start scraping...");
    const html = await fetchHtml(CONFIG.BASE_URL);
    const articles = extractArticles(html);

    if (articles.length === 0) {
      throw new Error(
        "No articles found. The website structure may have changed."
      );
    }

    console.log(
      `Found ${articles.length} articles. Processing top ${maxArticles}...`
    );

    const processedArticles = [];
    for (const [index, article] of articles.slice(0, maxArticles).entries()) {
      try {
        const normalizedLink = normalizeUrl(article.link);
        console.log(`Checking article ${index + 1}: ${normalizedLink}`);

        const exists = await articleExists(normalizedLink);
        if (exists) {
          console.log(
            `Article ${index + 1} already exists in database, skipping...`
          );
          continue;
        }

        console.log(
          `Processing article ${index + 1}/${Math.min(
            maxArticles,
            articles.length
          )}...`
        );

        // Fetch the article content
        const articleHtml = await fetchHtml(normalizedLink);
        const $ = cheerio.load(articleHtml);

        // Extract basic information
        const content =
          $("div.ok18-single-post-content-wrap").text().trim() ||
          $("div.news-details").text().trim() ||
          $("article").text().trim();

        const dateElement = $("span.posted-on time");
        const postedDate =
          dateElement.attr("datetime") ||
          dateElement.text().trim() ||
          new Date().toISOString().split("T")[0];

        const {
          paraphrased_title,
          paraphrased_content,
          captions,
          image_prompts,
        } = await paraphraseWithGemini(
          article.title,
          content.substring(0, 4000)
        );

        const articleData = {
          original_title: article.title,
          paraphrased_title: paraphrased_title || article.title,
          original_content: content.substring(0, 5000),
          paraphrased_content:
            paraphrased_content || content.substring(0, 5000),
          link: normalizedLink,
          posted_date: postedDate,
          source: "Onlinekhabar",
          scraped_at: new Date().toISOString(),
          image_prompts: image_prompts || [],
          captions: captions || ["#nepal", "#news", "#nepalinews"],
          image_generated: false,
          audio_generated: false,
          video_generated: false,
          upload_status: false,
          image_urls: [],
        };

        const storageResult = await storeArticles([articleData]);

        if (storageResult.success) {
          console.log(`Stored new article ${index + 1}`);
          processedArticles.push(articleData);
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(
          `Failed to process article ${index + 1}: ${error.message}`
        );
      }
    }

    if (processedArticles.length === 0) {
      console.log("No new articles were found to store.");
      return [];
    }

    console.log(
      `Successfully scraped and stored ${processedArticles.length} articles`
    );
    return processedArticles;
  } catch (error) {
    console.error("Scraping failed:", error.message);
  }
};

module.exports = {
  scrapeNews,
};
