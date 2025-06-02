const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-extra");
const { connect } = require("puppeteer-real-browser");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const stealthPlugin = StealthPlugin();
stealthPlugin.enabledEvasions.delete("iframe.contentWindow");
stealthPlugin.enabledEvasions.delete("navigator.plugins");
puppeteer.use(stealthPlugin);

// Add debug logging utility
const debug = {
  log: (message, type = "info") => {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${type.toUpperCase()}] ${message}`;
    console.log(logMessage);

    // Also write to a log file
    // fs.appendFileSync('tiktok-upload.log', logMessage + '\n');
  },
  error: (message, error) => {
    const errorDetail = error
      ? `\nError Details: ${error.message}\nStack: ${error.stack}`
      : "";
    debug.log(`${message}${errorDetail}`, "error");
  },
};

async function validateSession(page) {
  try {
    // Check if we're still logged in
    await page.goto("https://www.tiktok.com/friends", {
      waitUntil: "networkidle2",
    });

    const isLoggedIn = await page.evaluate(() => {
      // Look for common logged-in indicators
      return document.querySelector('[data-e2e="search-box"]') !== null;
    });

    if (!isLoggedIn) {
      debug.log("Session appears to be invalid or expired", "warning");
      return false;
    }

    debug.log("Session validation successful");
    return true;
  } catch (error) {
    debug.error("Error validating session", error);
    return false;
  }
}

async function loadSessionData(page, sessionFilePath) {
  try {
    if (!fs.existsSync(sessionFilePath)) {
      debug.error(`Session file not found: ${sessionFilePath}`);
      return false;
    }

    const sessionData = JSON.parse(fs.readFileSync(sessionFilePath, "utf8"));

    if (!sessionData.cookies || !sessionData.cookies.length) {
      debug.error("No cookies found in session data");
      return false;
    }

    debug.log(`Loading ${sessionData.cookies.length} cookies`);
    await page.setCookie(...sessionData.cookies);

    debug.log("Loading localStorage data");
    await page.evaluate((localStorageData) => {
      Object.keys(localStorageData).forEach((key) => {
        localStorage.setItem(key, localStorageData[key]);
      });
    }, sessionData.localStorageData);

    debug.log("Session data loaded successfully");
    return true;
  } catch (error) {
    debug.error("Error loading session data", error);
    return false;
  }
}

async function saveSessionData(page, sessionFilePath) {
  try {
    const cookies = await page.cookies();
    debug.log(`Saving ${cookies.length} cookies`);

    const localStorageData = await page.evaluate(() => {
      let data = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        data[key] = localStorage.getItem(key);
      }
      return data;
    });

    fs.writeFileSync(
      sessionFilePath,
      JSON.stringify({ cookies, localStorageData })
    );
    debug.log("Session data saved successfully");
    return true;
  } catch (error) {
    debug.error("Error saving session data", error);
    return false;
  }
}

async function getTiktokCookies(url, application_name) {
  let browser, page;
  try {
    debug.log("Launching browser for cookie capture");
    const connection = await connect({
      headless: false,
      turnstile: true,
      args: [
        "--start-maximized",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
      fingerprint: true,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    });
    browser = connection.browser;
    page = connection.page;

    debug.log("Setting up page configuration");
    await page.setBypassCSP(true);
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
    );

    debug.log(`Navigating to ${url}`);
    await page.goto(url, { waitUntil: "networkidle2" });

    debug.log("Waiting for manual login (120 seconds)");
    await new Promise((resolve) => setTimeout(resolve, 80000));

    const sessionSaved = await saveSessionData(
      page,
      `${application_name}_cookies.json`
    );
    if (!sessionSaved) {
      throw new Error("Failed to save session data");
    }
  } catch (error) {
    debug.error("Error in getTiktokCookies", error);
  } finally {
    if (browser) {
      debug.log("Closing browser");
      await browser.close();
    }
  }
}

async function checkUploadStatus(page) {
  try {
    // Check for error messages
    const errorElement = await page.$('[class*="error"], [class*="Error"]');
    if (errorElement) {
      const errorText = await errorElement.evaluate((el) => el.textContent);
      debug.log(`Upload error detected: ${errorText}`, "error");
      return { success: false, error: errorText };
    }

    // Check for success indicators
    const successIndicators = [
      '[data-icon*="success"]',
      '[class*="success"]',
      '[aria-label*="uploaded successfully"]',
    ];

    for (const selector of successIndicators) {
      const element = await page.$(selector);
      if (element) {
        debug.log("Upload success indicator found");
        return { success: true };
      }
    }

    return { success: false, error: "No success indicator found" };
  } catch (error) {
    debug.error("Error checking upload status", error);
    return { success: false, error: error.message };
  }
}

async function PostToTiktok(videoPath, content, hashtags) {
  console.log(hashtags, content, videoPath);
  let browser, page;
  try {
    const cleanedVideoPath = videoPath.startsWith("/")
      ? videoPath.slice(1)
      : videoPath;
    const absolutePath = path.resolve(
      __dirname,
      "../../public",
      cleanedVideoPath
    );

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Video file not found: ${absolutePath}`);
    }

    debug.log("Launching browser");
    const connection = await connect({
      headless: false,
      turnstile: true,
      // executablePath: 'user/bin/google-chrome',
      args: [
        "--start-maximized",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
      fingerprint: true,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    });
    browser = connection.browser;
    page = connection.page;

    debug.log("Navigating to TikTok login page");
    await page.goto("https://tiktok.com/login", { waitUntil: "networkidle2" });

    debug.log("Loading cookies");
    const cookiesPath = path.join(
      __dirname,
      "..",
      "..",
      "Cookies",
      "tiktok_cookies.json"
    );
    const cookiesLoaded = await loadSessionData(page, cookiesPath);
    if (!cookiesLoaded) {
      throw new Error("Failed to load cookies");
    }

    debug.log("Validating session");
    const isSessionValid = await validateSession(page);
    if (!isSessionValid) {
      throw new Error("Session validation failed - cookies may be expired");
    }

    debug.log("Navigating to upload page");
    await page.goto("https://www.tiktok.com/tiktokstudio/upload?from=upload", {
      waitUntil: "networkidle2",
    });

    debug.log("Waiting for file input");
    const inputFile = await page.waitForSelector('input[type="file"]', {
      visible: false,
      timeout: 30000,
    });

    if (!inputFile) {
      throw new Error("File input element not found");
    }

    debug.log("Uploading file");
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await inputFile.uploadFile(absolutePath);

    // Monitor upload progress
    const progressMonitor = setInterval(async () => {
      try {
        const progressElement = await page.$(
          'div.info-progress-num, [role="progressbar"], progress, .info-progress'
        );
        if (progressElement) {
          // const progress = await progressElement.evaluate(el => {
          //     const style = window.getComputedStyle(el);
          //     const widthProgress = parseFloat(style.width) / parseFloat(style.maxWidth) * 100;
          //     return widthProgress || el.value || 0;
          // });
          const progress = await progressElement.evaluate(
            (el) => el.textContent
          );
          debug.log(`Upload progress: ${progress}%`);
        }
      } catch (error) {
        // Ignore progress check errors
      }
    }, 1000);

    // Wait for upload completion
    await Promise.race([
      Promise.any([
        page.waitForSelector('[data-icon*="Check"], [data-icon*="Success"]', {
          visible: true,
          timeout: 120000,
        }),
        page.waitForFunction(
          () =>
            Array.from(document.querySelectorAll("*")).some((el) =>
              el.textContent.includes("Uploaded")
            ),
          { timeout: 120000 }
        ),
      ]),
      page.waitForFunction(
        () => {
          const progressElements = document.querySelectorAll(
            '[role="progressbar"], progress, .info-progress'
          );
          return Array.from(progressElements).some((el) => {
            const style = window.getComputedStyle(el);
            const progress =
              (parseFloat(style.width) / parseFloat(style.maxWidth)) * 100;
            return progress >= 100 || el.value >= 100;
          });
        },
        { timeout: 120000 }
      ),
    ]);

    clearInterval(progressMonitor);

    // Verify upload status
    const uploadStatus = await checkUploadStatus(page);
    if (!uploadStatus.success) {
      throw new Error(`Upload verification failed: ${uploadStatus.error}`);
    }

    debug.log("Upload confirmed successful, proceeding with caption");

    // Add caption
    debug.log("Adding caption");
    await page.waitForSelector('div[role="combobox"]');
    await page.click('div[role="combobox"]');
    await new Promise((resolve) => setTimeout(resolve, 500));

    // await page.keyboard.down('Control');
    // await page.keyboard.press('A');
    // await new Promise(resolve => setTimeout(resolve, 300));
    // await page.keyboard.up('Control');
    // await page.keyboard.press('Backspace');

    // await page.keyboard.down('Meta');
    // await page.keyboard.press('KeyA');
    // await new Promise(resolve => setTimeout(resolve, 300));
    // await page.keyboard.up('Meta');
    // await page.keyboard.press('Delete');

    await new Promise((resolve) => setTimeout(resolve, 500));

    // await page.evaluate(
    //   (text) => navigator.clipboard.writeText(text),
    //   `${content}\n\n`
    // );
    // await page.keyboard.down("Control");
    // await page.keyboard.press("V");
    // await page.keyboard.up("Control");

    for (const hashtag of hashtags) {
      for (const char of hashtag) {
        await page.keyboard.type(char, {
          delay: 100 + Math.floor(Math.random() * 100),
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 1600));
      await page.keyboard.press("Tab");
    }

    debug.log("Finalizing post");
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");

    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("ArrowDown");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Click Post button
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('[type="button"]'));
      const nextButton = buttons.find(
        (button) => button.textContent.trim() === "Post"
      );
      if (nextButton) nextButton.click();
    });

    debug.log("Post button clicked, waiting for completion");
    await new Promise((resolve) => {
      const randomDelay =
        Math.floor(Math.random() * (60000 - 45000 + 1)) + 45000;
      setTimeout(resolve, randomDelay);
    });

    debug.log("Post process completed successfully");
  } catch (error) {
    debug.error("Error in PostToTiktok", error);
    throw error;
  } finally {
    if (browser) {
      debug.log("Closing browser");
      await browser.close();
    }
  }
}

module.exports = { PostToTiktok, getTiktokCookies };
