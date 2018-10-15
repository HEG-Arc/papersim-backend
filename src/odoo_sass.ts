const Horseman = require('node-horseman');

const regexDB = /\/\/(.*?)\.odoo\.com/;
const regexUrl = /(https:\/\/accounts.odoo.com.* )/m;
const regexActivate = /confirm-database\/(.*?)\/(.*?)\?/;

function urlToDB(url: string) {
    const matchDB = regexDB.exec(url);
    return matchDB[1]
}

export function createDB(name: string, email: string): Promise<string> {
    return new Promise((resolve: (value: any) => void, reject: (value: any) => void) => {
        const horseman = new Horseman({
            timeout: 60 * 60 * 1000
        });
        horseman
        .userAgent('Mozilla/5.0 (Windows NT 6.1; WOW64; rv:27.0) Gecko/20100101 Firefox/27.0')
        .open('https://www.odoo.com/fr_FR/trial')
        .wait(1000)
        .click('[data-app="account"]')
        .wait(6000)
        .type('[name="username"]', 'Admin')
        .type('[name="email"]', email)
        .type('[name="company_name"]', name)
        .select('[name="country_id"]', 41)
        .select('[name="lang"]', 'fr_FR')
        .select('[name="company_size"]', '1-5')
        .select('[name="plan"]', 'plan_to_test')
        .click('[type="submit"]')
        .waitForSelector('.demo_subscribe_panel')
        .url()
        .then( (url: string) => {
            const db = urlToDB(url);
            resolve(db);
            console.log('created:', db); //https://edu-paper-test.odoo.com/web#home
        })
        .close()
        .catch((e:any) => {
            console.log("signup error", e)
            reject(e);
        })
    });
}

export function extrateActivationUrlFromMail(mailText: string): string {
    const matchUrl = regexUrl.exec(mailText);
    return matchUrl[1].trim();
}

export function activationUrl2DB(url: string): string {
    const matchActivate = regexActivate.exec(url);
    return matchActivate[1];
}

export function activateDB( url: string, password: string ): Promise<string> {
    return new Promise((resolve: (value: any) => void, reject: (value: any) => void) => {
        const horseman = new Horseman({
            timeout: 5 * 60 * 1000
        });

        const chain = horseman
        .userAgent('Mozilla/5.0 (Windows NT 6.1; WOW64; rv:27.0) Gecko/20100101 Firefox/27.0')
        .open(url)
        .url()
        .then((url: string) => {
            console.log(url);
            if (url.indexOf('accounts.odoo.com') > 0) {
                chain
                .evaluate( function (password: string) {
                    (<HTMLInputElement> document.getElementById('password')).value = password;
                    (<HTMLInputElement> document.getElementById('password-confirmation')).value = password;
                    var submit = <HTMLInputElement> document.querySelector('[type=submit]');
                    submit.disabled = false;
                    submit.click();
                }, password)
                .waitForNextPage()
                .evaluate( function () {
                    (<HTMLInputElement> document.querySelector('.btn.btn-default.o_db_activation_skip')).click();
                })
                .waitForNextPage()
                .evaluate( function () {
                    (<HTMLInputElement> document.querySelector('.o_db_activation_actions .btn.btn-primary')).click();
                })
                .url()
                .then( (url: string) => {
                    const db = urlToDB(url)
                    console.log('activated with new account:', db); // https://edu-paper-test45.odoo.com/web/login
                    horseman.close();
                    resolve(db);
                })
            } else {
                const db = urlToDB(url)
                console.log('activated with existing account:', db); // https://edu-paper-test45.odoo.com/web/login
                horseman.close();
                resolve(db);
            }
        });
    });
}

