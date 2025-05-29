const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const { connect } = require('puppeteer-real-browser');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const stealthPlugin = StealthPlugin();
stealthPlugin.enabledEvasions.delete('iframe.contentWindow');
stealthPlugin.enabledEvasions.delete('navigator.plugins');
puppeteer.use(stealthPlugin);

async function loadSessionData(page, sessionFilePath) {
    const sessionData = JSON.parse(fs.readFileSync(sessionFilePath, 'utf8'));

    await page.setCookie(...sessionData.cookies);

    await page.evaluate((localStorageData) => {
        Object.keys(localStorageData).forEach(key => {
            localStorage.setItem(key, localStorageData[key]);
        });
    }, sessionData.localStorageData);
}

async function saveSessionData(page, sessionFilePath) {
    const cookies = await page.cookies();
    const localStorageData = await page.evaluate(() => {
        let data = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            data[key] = localStorage.getItem(key);
        }
        return data;
    });

    fs.writeFileSync(sessionFilePath, JSON.stringify({ cookies, localStorageData }));
    console.log("Session data saved.");
}

// async function getInstagramCookies(url, application_name) {
//     try {
//         // Launch the browser in non-headless mode
//         const browser = await puppeteer.launch({
//             headless: false,
//             args: [
//                 '--start-maximized',
//                 '--no-sandbox',
//                 '--disable-setuid-sandbox',
//                 '--disable-blink-features=AutomationControlled',
//             ],
//             ignoreDefaultArgs: ['--enable-automation', '--disable-extensions', '--disable-default-apps', '--disable-component-extensions-with-background-pages'],
//             defaultViewport: null
//         });

//         // Open a new page and navigate to TikTok's upload URL
//         const page = await browser.newPage();
//         await page.setBypassCSP(true)
//         await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');

//         await page.goto(url, {
//             waitUntil: 'networkidle2'
//         });

//         console.log("Waiting for 120 seconds...");
//         await new Promise(resolve => setTimeout(resolve, 120000));

//         await saveSessionData(page, `${application_name}_cookies.json`);
//         console.log("Session data saved.");

//     } catch (error) {
//         console.error('Error posting to Youtube:', error);
//     }
// }

async function getInstagramCookies(url, application_name) {
    try {
        // Connect to a real browser using puppeteer-real-browser
        const { browser, page } = await connect({
            headless: false,
            turnstile: true, // Optional: helps bypass Cloudflare challenges
            args: [
                '--start-maximized',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
            ],
            fingerprint: true, // Optional: generates a more realistic browser fingerprint
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
        });

        // Navigate to the URL
        await page.goto(url, {
            waitUntil: 'networkidle2'
        });

        console.log("Waiting for 100 seconds...");
        await new Promise(resolve => setTimeout(resolve, 150000));

        await saveSessionData(page, `${application_name}_cookies.json`);
        console.log("Session data saved.");

        // Close the browser when done
        await browser.close();

    } catch (error) {
        console.error('Error getting Instagram cookies:', error);
    }
}

async function PostToInstagram(videoPath) {
    try {
        const { browser, page } = await connect({
            headless: false,
            turnstile: true, // Optional: helps bypass Cloudflare challenges
            
        // executablePath: '/usr/bin/chromium-browser',
            args: [
                '--start-maximized',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
            ],
            fingerprint: true, // Optional: generates a more realistic browser fingerprint
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
        });

        await page.goto('https://www.instagram.com/accounts/login/', {
            waitUntil: 'networkidle2'
        });

        console.log('Injecting cookies to Instagram')
        const cookiesPath = path.join(__dirname, '..', '..', 'Cookies', 'instagram_cookies.json')
        await loadSessionData(page, cookiesPath);
        console.log('Injected.')

        await page.goto('https://instagram.com/', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        // Wait for the 'Create' button to appear and click it
        // await page.waitForSelector('div.x6s0dn4.x9f619.xxk0z11.x6ikm8r.xeq5yr9.x1swvt13.x1s85apg.xzzcqpx');
        await page.waitForSelector('svg[aria-label="New post"]');
        await page.click('svg[aria-label="New post"]');
        console.log("Clicked on Create Button.")

        await page.waitForSelector('svg[aria-label="Post"]');
        await page.click('svg[aria-label="Post"]');
        console.log("Clicked on Post Button.")

        await new Promise(resolve => setTimeout(resolve, 600));

        const inputFile = await page.waitForSelector('input[type="file"]', {
            visible: false, // File inputs are typically hidden
            timeout: 30000  // 30 second timeout
        });

        if (inputFile) {
            await inputFile.uploadFile(videoPath);
            console.log('Waiting for file upload to complete...');
        } else {
            console.log("File input element not found.");
            throw new Error("File input element not found");
        }

        await new Promise(resolve => setTimeout(resolve, 5000));

        await page.waitForSelector('div.x78zum5.x1q0g3np.xdko459');
        await page.evaluate(() => {
            const okButtonDiv = Array.from(document.querySelectorAll('div.x78zum5.x1q0g3np.xdko459'))
                .find(div => div.textContent.includes('OK'));
            if (okButtonDiv) {
                const okButton = okButtonDiv.querySelector('button');
                if (okButton) okButton.click();
            }
        });

        await new Promise(resolve => setTimeout(resolve, 1500));

        // await page.keyboard.press('Tab');
        // await new Promise(resolve => setTimeout(resolve, 200));
        // await page.keyboard.press('Enter');
        // await new Promise(resolve => setTimeout(resolve, 500));

        // Steps to choose original video aspect ratio
        await page.waitForSelector('svg[aria-label="Select crop"]');
        await page.click('svg[aria-label="Select crop"]');
        await new Promise(resolve => setTimeout(resolve, 500));

        await page.waitForSelector('svg[aria-label="Photo outline icon"]');
        await page.click('svg[aria-label="Photo outline icon"]');
        await new Promise(resolve => setTimeout(resolve, 800));

        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('[role="button"]'));
            const nextButton = buttons.find(button => button.textContent.trim() === 'Next');
            if (nextButton) nextButton.click();
        });
        await new Promise(resolve => setTimeout(resolve, 1500));

        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('[role="button"]'));
            const nextButton = buttons.find(button => button.textContent.trim() === 'Next');
            if (nextButton) nextButton.click();
        });
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Write caption 
        await page.waitForSelector('div[role="textbox"]');
        await page.click('div[role="textbox"]');
        await new Promise(resolve => setTimeout(resolve, 500));

        // Define the caption text
        const caption = `Stay updated with the latest news and trends! 🌍📰 Follow us for breaking stories, insights, and updates that matter to you. 📢💡 \n\n#BreakingNews #Trending #Nepal #Nepali #News #WorldNews #CurrentEvents #TechNews #BusinessNews #Entertainment #Sports #GlobalUpdates #StayInformed`;
        // const hashtags = '#motivation #inspiration #success #love #lovequotes #success #entrepreneur #goals #couplegoals #loveyourself #relationshipgoals';

        // Type message with human-like delays
        await page.evaluate((text) => navigator.clipboard.writeText(text), caption);
        await page.keyboard.down('Control');
        await page.keyboard.press('V');
        await page.keyboard.up('Control');

        await new Promise(resolve => setTimeout(resolve, 2000));

        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('[role="button"]'));
            const nextButton = buttons.find(button => button.textContent.trim() === 'Share');
            if (nextButton) nextButton.click();
        });
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Wait for confirmation message
        await page.waitForFunction(() => {
            const element = document.querySelector('span[dir="auto"]');
            return element && element.textContent.includes('Your reel has been shared');
        }, { timeout: 60000 });

        console.log('Reel uploaded successfully!');

        const randomDelay = Math.floor(Math.random() * (45000 - 30000 + 1)) + 30000;
        await new Promise(resolve => setTimeout(resolve, randomDelay));

        await browser.close();

    } catch (error) {
        console.error('Error posting to TikTok:', error);
    }
}

module.exports = { PostToInstagram, getInstagramCookies };