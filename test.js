const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: 'C:\\Users\\An\\.cache\\puppeteer\\chrome-headless-shell\\win64-148.0.7778.97\\chrome-headless-shell.exe'
  });
  
  const page = await browser.newPage();
  await page.goto('https://example.com');
  console.log('Заголовок страницы:', await page.title());
  
  await browser.close();
  console.log('Успех!');
})();