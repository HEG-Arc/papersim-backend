const puppeteer = require("puppeteer");

const regexDB = /\/\/(.*?)\.odoo\.com/;
const regexUrl = /(https:\/\/accounts.odoo.com.* )/m;
const regexActivate = /confirm-database\/(.*?)\/(.*?)\?/;
const timeout = 5 * 60 * 1000;

function urlToDB(url: string) {
  const matchDB = regexDB.exec(url);
  return matchDB[1];
}

export function createDB(name: string, email: string): Promise<string> {
  return new Promise(
    (resolve: (value: any) => void, reject: (value: any) => void) => {
      (async () => {
        const browser = await puppeteer.launch({
            args: ['--no-sandbox']
        });
        try {
          console.log("signup for ", name, "with", email);
          const page = await browser.newPage();
          await page.goto("https://www.odoo.com/fr_FR/trial");
          await page.waitFor(1000);
          await page.click('[data-app="account"]');
          await page.waitFor(5000);
          await page.type('[name="username"]', "Admin");
          await page.type('[name="email"]', email);
          await page.type('[name="company_name"]', name);
          await page.select('[name="country_id"]', "41");
          await page.select('[name="lang"]', "fr_FR");
          await page.select('[name="company_size"]', "1-5");
          await page.select('[name="plan"]', "plan_to_test");
          await page.click('[type="submit"]');
          await page.waitForSelector(".demo_subscribe_panel", {
            timeout
          });
          const db = urlToDB(page.url());
          resolve(db);
          console.log("created:", db);
        } catch (e) {
          console.log("signup error", e);
          reject(e);
        }
        await browser.close();
      })();
    }
  );
}

export function extrateActivationUrlFromMail(mailText: string): string {
  const matchUrl = regexUrl.exec(mailText);
  return matchUrl[1].trim();
}

export function activationUrl2DB(url: string): string {
  const matchActivate = regexActivate.exec(url);
  return matchActivate[1];
}

export function activateDB(url: string, password: string): Promise<string> {
  return new Promise(
    (resolve: (value: any) => void, reject: (value: any) => void) => {
      (async () => {
        const browser = await puppeteer.launch({
            args: ['--no-sandbox']
        });
        const page = await browser.newPage();
        await page.goto(url);
        console.log(page.url());
        // 3 cases new user, existing user, already activated (https://accounts.odoo.com/database_validated)
        if (page.url() === "https://accounts.odoo.com/database_validated") {
            return;
          }
        await page.type("#password", password);
        await page.type("#password-confirmation", password);
        await page.evaluate(() => {
          var submit = <HTMLInputElement>(
            document.querySelector("[type=submit]")
          );
          submit.disabled = false;
          submit.click();
        });
        try {
            await page.waitForNavigation();
            await page.evaluate(() => {
              const e = <HTMLInputElement>(
                document.querySelector(".btn.btn-default.o_db_activation_skip")
              );
              if (e) {
                e.click();
              }
            });
            await page.waitFor(1000);
            await page.evaluate(() => {
                const e = <HTMLInputElement>(
                  document.querySelector(".btn.btn-default.o_db_activation_skip")
                );
                if (e) {
                  e.click();
                }
              });
            await page.waitFor(1000);
            await page.evaluate(() => {
              const e = <HTMLInputElement>(
                document.querySelector(".o_db_activation_actions .btn.btn-primary")
              );
              if (e) {
                e.click();
              }
            });
            await page.waitForNavigation();
        } catch (e) {
          console.log("activation error", e);
        }
        const db = activationUrl2DB(url);
        console.log("activated with new account:", db);
        resolve(db);
        await browser.close();
      })();
    }
  );
}
