/// <reference path="typings/odoo.d.ts"/>
import { Game, Company, GameState } from './sim';
import * as fs from 'fs';
import Odoo = require('odoo');

// TODO: How are date input calculated??? GMT Offset...
/*
contexte
"tz": "GMT",
*/


function objectToDomain(obj: Object) {
    return Object.keys(obj).reduce((domain: any[], key: string) => {
        if (!Array.isArray((<any>obj)[key])) {
            domain.push([key, '=', (<any>obj)[key]]);
        }
        return domain;
    }, []);
}

function simDayToDateTime(day:number):string {
     day = Math.max(day, 0);
     return '2016-01-' + ('00' + (day + 1)).slice(-2) + ' 00:00:00';
}

function zeroPadding(number: number): string {
    return ('00000' + number).slice(-5);
}

// Game configs

export let partnerSupplier = {
    name: 'Scierie Sàrl',
    company_type: 'company',
    active: true,
    is_company: true,
    customer: false,
    supplier: true
};

export let partnerMarket = {
    name: 'Marché',
    company_type: 'company',
    active: true,
    is_company: true,
    customer: true,
    supplier: false
};

export let productWood: any = {
    active: true,
    name: 'Bois',
    sale_ok: false,
    purchase_ok: true,
    type: 'product',
    //FIX: change in Odoo10? purchase_method: 'receive',
    taxes_id: [],  // disable tax
    supplier_taxes_id: []
};

export let productPaper: any = {
    active: true,
    name: 'Paper',
    sale_ok: true,
    purchase_ok: false,
    type: 'product',
    //FIX: change in Odoo10?  purchase_method: 'receive',
    taxes_id: [],
    supplier_taxes_id: [],
    warranty: 0,
    produce_delay: 0,
    sale_delay: 0
};

export class OdooAdapter {

    public config:any = {
        autoCommitPo: false,
        autoCommitSo: false
    };

    public cache: any = {};
    public cacheDailyPoId: number[] = [];
    public cacheDailySoId: number[] = [];
    public cacheDailyCustomerInvoiceId: number[] = [];

    public odoo: Odoo;
    private gameState: GameState;
    private currentDay: string;
    private currentDayTime: string;

    constructor(private game: Game, private company: Company) {
        try {
            this.odoo = new Odoo({
                host: `${company.odoo.database}.odoo.com`,
                port: 443,
                database: company.odoo.database,
                username: company.odoo.username,
                password: company.odoo.password,
                protocol: 'https'
            });
        } catch(e) {
            console.log('error init odoo connection');
        }
        game.pubsub.on('state', this.stateListener.bind(this));
        // TODO: listen for checkrequests
        // TODO: emit errors, logs
    }

    updateGameStateAndDay(game: Game) {
        this.gameState = game.getState();
        this.currentDayTime = simDayToDateTime(this.gameState.currentDay);
        this.currentDay = this.currentDayTime.slice(0, 10);
        console.log(this.gameState, this.currentDayTime, this.currentDay);
    }

    async stateListener(game: Game, params: { from: string, to: string, payload: any }) {
        this.updateGameStateAndDay(game);
        switch (params.to) {
            // TODO error handling
            case 'decidingMarketPriceState':
                // setup market price and SO
                await this.updateSalesProductPrice(this.cache[productPaper.name], params.payload.price);
                this.cacheDailySoId[this.gameState.currentDay] = await this.createSalesOrder(this.cache[partnerMarket.name],
                                                                                             this.cache[productPaper.name],
                                                                                             params.payload.price);
                break;
            case 'acceptingSalesState':
                // process confirmed SO
                // check price correct? copy qty to sim
                this.cacheDailySoId[this.gameState.currentDay] = await this.readAndCheckSo(this.cacheDailySoId[this.gameState.currentDay]);
                break;
            case 'salesDelvieryState':
                // stock picking and invoicing
                if ( this.cacheDailySoId[this.gameState.currentDay] ) {
                    await this.deliverSales(this.cacheDailySoId[this.gameState.currentDay]);
                    this.cacheDailyCustomerInvoiceId[this.gameState.currentDay] = await this.createCustomerInvoice(
                        this.cacheDailySoId[this.gameState.currentDay]);
                }
                break;

                //TODO: custom state for company
            case 'customerPayingInvoicesState':
                // make payment for invoice day-x
                if ( this.cacheDailyCustomerInvoiceId[params.payload.payOutForDay] ) {
                    await this.payCustomerInvoice(this.cacheDailyCustomerInvoiceId[params.payload.payOutForDay],
                        params.payload.price * params.payload.sales[this.company.name]);
                }
                break;
            case 'decidingSupplierPriceState':
                // setup product price and PO
                await this.updateSupplierProductPrice(this.cache[partnerSupplier.name],
                                                      this.cache[productWood.name],
                                                      params.payload.price);
                this.cacheDailyPoId[this.gameState.currentDay] = await this.createPurchaseOrder(this.cache[partnerSupplier.name],
                                                                                                this.cache[productWood.name],
                                                                                                params.payload.price);
                break;
            case 'acceptingPurchasesState':
                // TODO: timer?
                this.cacheDailyPoId[this.gameState.currentDay] = await this.readAndCheckPo(this.cacheDailyPoId[this.gameState.currentDay]);
                break;

                //TODO: custom event for company
            case 'deliveringPurchasesState':
                // Get id from cache for right date
                let qty: number = params.payload.orders[this.company.name];
                if ( qty > 0) {
                    // delivery and picking
                    await this.deliverSupplies(this.cacheDailyPoId[params.payload.supplyForPurchaseDay]);
                    // invoice payment
                    let invoiceId: number = await this.createPurchaseInvoice(this.cacheDailyPoId[params.payload.supplyForPurchaseDay],
                            qty, params.payload.price);
                    await this.paySupplierInvoice(invoiceId);
                    await this.lockPurchaseOrder(this.cacheDailyPoId[params.payload.supplyForPurchaseDay]);
                    // produce new delivered qty
                    await this.produce(this.currentDay, qty, qty * this.gameState.productionRawToFinished);
                }
                break;
        }
    }

    destroy() {
        this.game.pubsub.off('state', this.stateListener);
    }

    async execute(callback: (resolve: (value: any) => void, reject: (value: any) => void) => void, force: boolean = false): Promise<any> {
        return new Promise((resolve: (value: any) => void, reject: (value: any) => void) => {
            if (this.odoo.context && !force) {
                callback(resolve, reject);
            } else {
                this.odoo.connect((err: any) => {
                    if (err) {
                        console.log('execute connect err', err);
                        return reject(err);
                    }
                    callback(resolve, reject);
                });
            }
        });
    }

    createDefaultResponseHandler(resolve: Function, reject: Function): (err: any, result: any) => void {
        return (err, result) => {
            if (err) {
                console.log('ERR', err);
                return reject(err);
            }
            console.log('INFO', result);
            resolve(result);
        };
    }

    // TODO: namespace cache?
    createCacheResponseHandler(obj: { name: string } | string, resolve: Function, reject: Function): (err: any, result: any) => void {
        return (err, result) => {
            this.createDefaultResponseHandler(() => { }, () => { })(err, result);
            let key = typeof obj === 'string' ? obj : obj.name;
            if (!result) {
                return reject(`ERR null response: ${key}`);
            }
            if (result.hasOwnProperty('length')) {
                if (result.length > 0) {
                    result = result[0];
                } else {
                    return reject(`NOT_FOUND: ${key}`);
                }
            }
            this.cache[key] = result;
            resolve(result);
        };
    }

    makePaperBom(paperId: number, woodId: number) {
        return {
            product_tmpl_id: paperId,
            product_qty: this.gameState.productionRawToFinished,
            //FIX: change in Odoo10? product_uom: 1,
            bom_line_ids: [[0, false, {
                product_qty: 1,
                product_uom: 1,
                sequence: 1,
                product_id: woodId,
            }]]
        };

    }

    async createConfig() {
        try {
            await this.createPartner(partnerSupplier);
            await this.createPartner(partnerMarket);
            let woodId = await this.createProduct(productWood);
            let paperId = await this.createProduct(productPaper);
            let bom = this.makePaperBom(paperId, woodId);
            await this.createBOM(bom);
            await this.setInitialProductQuantity(paperId, this.gameState.initialStock);
            await this.setInitialFund(this.gameState.initialCash);
        } catch (e) {
            console.log('ERR', e);
        }
    }

    async check(name: string, func: Function): Promise<any> {
        let test: any = {
                name: name,
                valid: false
            };
        try {
            test.result = await func();
            test.valid = true;
        }
        finally{
            return test;
        }

    }

    async checkConfig() {
        this.gameState = this.game.getState();

        // parallelized
        let checked = await Promise.all([
            this.check(partnerSupplier.name, async () => {
                return this.checkPartner(partnerSupplier);
            }),
            this.check(partnerMarket.name, async () => {
                return this.checkPartner(partnerMarket);
            }),
            this.check(productWood.name, async () => {
                let woodId = await this.checkProduct(productWood);
                this.updateProductImage(woodId, 'assets/wood.jpg');
                return woodId
            }),
            this.check(productPaper.name, async () => {
                let paperId = await this.checkProduct(productPaper);
                this.updateProductImage(paperId, 'assets/paper.jpg');
                return paperId;
            }),
        ]);

        if(checked[2].valid && checked[3].valid) {
            checked.push(
                await this.check('BOM', async () => {
                    return this.checkBOM(this.makePaperBom(checked[3].result, checked[2].result));
            }));
        } else {
            checked.push({'name': 'BOM', valid: false});
        }

        // TODO: emit error for frontend?
        // TODO check stock level
        // TODO check account cash

        return checked;
    }

    async preload() {
        try {
            await this.getAccountIdByCode('1001');
            await this.getAccountIdByCode('2800');
            await this.getAccountIdByCode('4200');
            await this.getLocationIdByName('Stock');
            await this.getJournalIdByCode('BILL');
            await this.getJournalIdByCode('INV');
        } catch (e) {
            console.log('ERR', e);
            //TODO: emit erro
        }
    }



    async checkPartner(partner: any): Promise<any> {
        return this.execute((resolve: Function, reject: Function) => {
            this.odoo.search('res.partner', {
                domain: objectToDomain(partner)
            }, this.createCacheResponseHandler(partner, resolve, reject));
        });
    }

    async createPartner(partner: any): Promise<any> {
        return this.execute((resolve: Function, reject: Function) => {
            this.odoo.create('res.partner', partner, this.createCacheResponseHandler(partner, resolve, reject));
        });
    }

    async checkProduct(product: any): Promise<any> {
        return this.execute((resolve: Function, reject: Function) => {
            this.odoo.search('product.template', {
                domain: objectToDomain(product)
            }, this.createCacheResponseHandler(product, resolve, reject));
            // TODO check many2many seller, taxes, ...
        });
    }

    async createProduct(product: any): Promise<any> {
        return this.execute((resolve: Function, reject: Function) => {
            this.odoo.create('product.template', product, this.createCacheResponseHandler(product, resolve, reject));
        });
    }

    async updateProductImage(productId: number, path: string): Promise<any> {
        return this.execute((resolve: Function, reject: Function) => {
            this.odoo.update('product.template', productId, {
                // 128x128
                image_medium: fs.readFileSync(path, 'base64')
            }, this.createDefaultResponseHandler(resolve, reject));
        });
    }

    async checkBOM(bom: any): Promise<any> {
        return this.execute((resolve: Function, reject: Function) => {
            this.odoo.search('mrp.bom', {
                domain: objectToDomain(bom)
            }, this.createCacheResponseHandler('BOM', resolve, reject));
        });
        // TODO: check bom_lines
    }

    async createBOM(bom: any): Promise<any> {
        return this.execute((resolve: Function, reject: Function) => {
            this.odoo.create('mrp.bom', bom, this.createCacheResponseHandler('BOM', resolve, reject));
        });
    };

    async getAccountIdByCode(code: string): Promise<any> {
        if (this.cache.hasOwnProperty(code)) {
            return new Promise((resolve) => {
                resolve(this.cache[code]);
            });
        }
        return this.execute((resolve: Function, reject: Function) => {
            this.odoo.search('account.account', {
                domain: [
                    ['code', '=', code]
                ]
            }, this.createCacheResponseHandler(code, resolve, reject));
        });
    }

    async getJournalIdByCode(code: string): Promise<any> {
        if (this.cache.hasOwnProperty(code)) {
            return new Promise((resolve) => {
                resolve(this.cache[code]);
            });
        }
        return this.execute((resolve: Function, reject: Function) => {
            this.odoo.search('account.journal', {
                domain: [
                    ['code', '=', code]
                ]
            }, this.createCacheResponseHandler(code, resolve, reject));
        });
    }

    async getLocationIdByName(name: string): Promise<any> {
        if (this.cache.hasOwnProperty(name)) {
            return new Promise((resolve) => {
                resolve(this.cache[name]);
            });
        }
        return this.execute((resolve: Function, reject: Function) => {
            this.odoo.search('stock.location', {
                domain: [
                    ['name', '=', name]
                ]
            }, this.createCacheResponseHandler(name, resolve, reject));
        });
    }

    async setInitialProductQuantity(productId: number, quantity: number): Promise<any> {
        let stockLocationId = await this.getLocationIdByName('Stock');
        return this.execute((resolve: (value: any) => void, reject: (value: any) => void) => {
            this.odoo.create('stock.inventory', {
                name: 'INITIAL',
                filter: 'product',
                accounting_date: this.currentDay,
                product_id: productId,
                lot_id: false,
                location_id: stockLocationId,
                line_ids: [[0, false,
                    {
                        product_id: productId,
                        product_uom_id: 1,
                        product_qty: quantity,
                        location_id: stockLocationId
                    }]]
            }, (err: any, res: any) => {
                if (err) {
                    return this.createDefaultResponseHandler(resolve, reject)(err, res);
                }
                this.odoo.rpc_call('/web/dataset/call_button', {
                    model: 'stock.inventory',
                    method: 'action_done',
                    args: [[res]]
                }, (err, res2) => {
                    this.updateStockMoveDate([['inventory_id', '=', res]], '2016-01-01 00:00:00').then(resolve, reject);
                });
            });
        });
    }

    async setInitialFund(amount: number): Promise<any> {
        let journalId = await this.getJournalIdByCode('CSH1');
        let cashAccountId = await this.getAccountIdByCode('1001');
        let capitalAccountId = await this.getAccountIdByCode('2800');
        return this.execute((resolve: Function, reject: Function) => {
            this.odoo.create('account.move', {
                journal_id: journalId,
                date: this.currentDay,
                line_ids: [[0, false,
                    {
                        credit: 0,
                        amount_currency: 0,
                        account_id: cashAccountId,
                        debit: amount,
                        name: 'cash',
                    }], [0, false,
                        {
                            credit: amount,
                            amount_currency: 0,
                            account_id: capitalAccountId,
                            debit: 0,
                            name: 'cash',
                        }]]
            }, (err: any, res: any) => {
                if (err) {
                    return this.createDefaultResponseHandler(resolve, reject)(err, res);
                }
                this.odoo.rpc_call('/web/dataset/call_button', {
                    model: 'account.move',
                    method: 'post',
                    args: [[res]]
                }, this.createDefaultResponseHandler(resolve, reject));
            });
        });
    }

    async updateStockMoveDate(domain: any[], date: string): Promise<any> {
        return this.execute((resolve: Function, reject: Function) => {
            this.odoo.search('stock.move', { domain: domain }, (err: any, res: any) => {
                for (let id of res) {
                    this.odoo.update('stock.move', id, {
                        date: date,
                        date_expected: date
                    }, this.createDefaultResponseHandler(resolve, reject));
                }
            });
        });
    }

    /*
    *
    * SUPPLY
    *
    */

    async updateSupplierProductPrice(partnerId: number, productId: number, price: number): Promise<any> {
        return this.execute((resolve, reject) => {
            this.odoo.update('product.template', productId, {
                'seller_ids': [
                    [0, false, {
                        name: partnerId,
                        delay: this.gameState.supplierDayToPay,
                        price: price,
                        date_start: this.currentDay,
                        date_end: this.currentDay
                    }]]
            }, this.createDefaultResponseHandler(resolve, reject));
        });
    }

    async createPurchaseOrder(partnerId: number, productId: number, price: number): Promise<any> {
        let simDayDelivery = this.gameState.currentDay + this.gameState.supplierDayToPay;
        let datePlanned = simDayToDateTime(simDayDelivery);
        let po: any = {
            partner_id: partnerId,
            date_order: this.currentDayTime,
            order_line: [[0, false,{
                product_id: productId,
                date_planned: datePlanned,
                product_qty: this.gameState.supplierMaxOrderSize,
                product_uom: 1,
                price_unit: price,
                taxes_id: [],
                name: productWood.name // TODO: as parameter // description field in PO
            }]],
            date_planned: datePlanned
        };
        return this.execute((resolve, reject) => {
            this.odoo.create('purchase.order', po, (err, poId) => {
                if (this.config.autoCommitPo) {
                     this.odoo.rpc_call('/web/dataset/call_button', {
                        model: 'purchase.order',
                        method: 'button_confirm',
                        args: [[poId]]
                    }, (err, res) => {
                        this.createDefaultResponseHandler(resolve, reject)(err, poId);
                    });
                } else {
                    this.createDefaultResponseHandler(resolve, reject)(err, poId);
                }
            });
        });
    };

    async validatePicking(pickingId: number): Promise<any> {
        return new Promise(async (resolve, reject) => {
            try {
                //TODO check if possible to directly create right stock move?
                let res = await this.execute((resolve, reject) => {
                    this.odoo.rpc_call('/web/dataset/call_button', {
                        model: 'stock.picking',
                        method: 'do_new_transfer',
                        args: [[pickingId]]
                    }, this.createDefaultResponseHandler(resolve, reject));
                });
                await this.execute((resolve, reject) => {
                    this.odoo.rpc_call('/web/dataset/call_button', {
                        model: 'stock.immediate.transfer',
                        method: 'process',
                        args: [[res.res_id]]
                    }, this.createDefaultResponseHandler(resolve, reject));
                });
                await this.updateStockMoveDate( [['picking_id', '=', pickingId]], this.currentDayTime);
                resolve();
            } catch(e) {
                reject(e);
            }
        });
    }

    async readAndCheckPo(poId: number): Promise<any> {
        return new Promise(async (resolve, reject) => {
            try {
                let po: any = await this.execute((resolve, reject) => {
                    this.odoo.get('purchase.order', {ids: [poId]}, this.createDefaultResponseHandler(resolve, reject));
                });
                if (po[0] && po[0].state === 'purchase') {
                    // get qty from order
                    this.odoo.get('purchase.order.line', {ids: po[0].order_line}, (err, res) => {
                        // FIX for now only take first line
                        if (err) { return reject(err); }
                        let qty = res[0].product_qty
                        console.log('PO qty', qty);
                        // checks done in sim.
                        this.game.input(this.company.name, qty);
                        resolve(poId);
                    });
                } else {
                    // TODO: auto cancel po?
                    console.log('TODO: auto cancel po?');
                    resolve(null);
                }
            } catch(e) {
                reject(e);
            }
        });
    }

    async deliverSupplies(poId: number): Promise<any> {
        // find picking for po
        let pickingId = await this.execute((resolve, reject) => {
            this.odoo.search('stock.picking', {
            domain: [
                ['purchase_id', '=', poId]
            ]
            }, this.createDefaultResponseHandler(resolve, reject));
        });
        return this.validatePicking(pickingId[0]);
    }

    async createPurchaseInvoice(poId: number, qty: number, price: number): Promise<any> {
        return this.execute((resolve, reject) => {
            this.odoo.create('account.invoice', {
                partner_id: this.cache[partnerSupplier.name],
                origin: 'PO' + zeroPadding(poId),
                date_invoice: this.currentDay,
                date_due: this.currentDay,
                journal_id: this.cache['BILL'],
                type: 'in_invoice',
                invoice_line_ids: [[0, false,
                    {
                        purchase_id: poId,
                        name: 'PO' + zeroPadding(poId),
                        price_unit: price,  // from sim for now
                        uom_id: 1,
                        invoice_line_tax_ids: [],
                        discount: 0,
                        quantity: qty, // from sim for now
                        product_id: this.cache[productWood.name],
                        account_id: this.cache['4200'], // lookup
                        purchase_line_id: poId // test?
                    }]],
                tax_line_ids: [],
                date: this.currentDay
            }, (err, invoiceId) => {
                // workflow validate invoice
                console.log('invoice created', err, invoiceId);
                if (err) return reject(err);
                /* odoo 9 workflow */
                /*
                this.odoo.rpc_call('/web/dataset/exec_workflow', {
                    model: 'account.invoice',
                    id: invoiceId,
                    signal: 'invoice_open'
                }, (err: any, res: any) => {
                    this.createDefaultResponseHandler(resolve, reject)(err, invoiceId);
                });
                */
                this.odoo.rpc_call('/web/dataset/call_button', {
                    model: 'account.invoice',
                    method: 'action_invoice_open',
                    args: [[ invoiceId ]]
                    }, (err: any, res: any) => {
                        this.createDefaultResponseHandler(resolve, reject)(err, invoiceId);
                    });
            });
        });
    }

    async makePayment(payment:any): Promise<any> {
        return this.execute((resolve, reject) => {
            console.log('makePayment', payment);
            this.odoo.create('account.payment', payment, (err: any, paymentId: any) =>  {
                if (err) {
                    reject(err);
                    return;
                }
                console.log('post payment', paymentId);
                this.odoo.rpc_call('/web/dataset/call_button', {
                    model: 'account.payment',
                    method: 'post',
                    args: [[paymentId]]
                }, (err: any, res: any) => {
                    this.createDefaultResponseHandler(resolve, reject)(err, paymentId);
                });
            });
        });
    }


    async paySupplierInvoice(invoiceId: number): Promise<any> {
        return this.execute((resolve, reject) => {
            this.odoo.get('account.invoice', {ids: [invoiceId], fields: ['number']}, (err, res) => {
                if (err) { return reject(err); }
                this.makePayment({
                    payment_type: 'outbound',
                    partner_type: 'supplier',
                    partner_id: this.cache[partnerSupplier.name],
                    journal_id: this.cache['BILL'],
                    payment_method_id: 1, // TODO: lookup cash?
                    amount: 10, // TODO: from invoice or sim??
                    payment_date: this.currentDay,
                    communication: res[0].number,
                    invoice_ids: [[4, invoiceId, null]]
                }).then(resolve, reject);
            });
        });
    }

    async lockPurchaseOrder(poId: number): Promise<any> {
        return this.execute((resolve, reject) => {
            // lock invoice
            this.odoo.rpc_call('/web/dataset/call_button', {
                model: 'purchase.order',
                method: 'button_done',
                args: [[poId]]
            }, this.createDefaultResponseHandler(resolve, reject));
        });
    }

    /*
    *
    * SALES
    *
    */

    async updateSalesProductPrice(productId: number, price: number): Promise<any> {
        return this.execute((resolve, reject) => {
            this.odoo.update('product.product', productId, {
                lst_price: price
            },  this.createDefaultResponseHandler(resolve, reject));
        });
    }

    async createSalesOrder(customerId: number, productId: number, price: number): Promise<any> {
        let so: any = {
            partner_id: customerId,
            partner_invoice_id: customerId,
            partner_shipping_id: customerId,
            date_order: this.currentDayTime,
            validity_date: this.currentDay,
            state: 'sent',
            order_line: [[0, false,
            {
                price_unit: price,
                product_uom_qty: 1,
                product_id: productId,
                product_uom: 1,
                tax_id: [],
            }]]
        };

        return this.execute((resolve, reject) => {
            this.odoo.create('sale.order', so, (err, soId) => {
                if (this.config.autoCommitSo) {
                    // creates picking entry
                     this.odoo.rpc_call('/web/dataset/call_button', {
                        model: 'sale.order',
                        method: 'action_confirm',
                        args: [[soId]]
                    }, (err, res) => {
                        this.createDefaultResponseHandler(resolve, reject)(err, soId);
                    });
                } else {
                    this.createDefaultResponseHandler(resolve, reject)(err, soId);
                }
            });
        });
    };

    async readAndCheckSo(soId: number): Promise<any> {
        return new Promise(async (resolve, reject) => {
            try {
                let so: any = await this.execute((resolve, reject) => {
                    this.odoo.get('sale.order', {ids: [soId]}, this.createDefaultResponseHandler(resolve, reject));
                });
                if (so[0] && so[0].state === 'sale') {
                    // get qty from order
                    this.odoo.get('sale.order.line', {ids: so[0].order_line}, (err, res) => {
                        // FIX for now only take first line
                        if (err) { return reject(err); }
                        let qty = res[0].product_uom_qty
                        console.log('SO qty', qty);
                        // checks done in sim.
                        this.game.input(this.company.name, qty);
                        resolve(soId);
                    });
                } else {
                    // TODO: auto cancel so?
                    console.log('TODO: auto cancel so?');
                    resolve(null);
                }
            } catch(e) {
                reject(e);
            }
        });
    }

    async deliverSales(soId: number): Promise<any> {
        let pickingId = await this.execute((resolve, reject) => {
            this.odoo.search('stock.picking', {
            domain: [
                ['sale_id', '=', soId]
            ]
            }, this.createDefaultResponseHandler(resolve, reject));
        });
        return this.validatePicking(pickingId[0]);
    }

    async createCustomerInvoice(soId: number): Promise<any> {
        return this.execute((resolve, reject) => {
            this.odoo.create('sale.advance.payment.inv', {
                advance_payment_method: 'all',
                amount: 0,
                product_id: false,
                deposit_account_id: false,
                deposit_taxes_id: []
            }, (err: any, m: any) => {
                if (err) { return reject(err); }
                    console.log('create invoice');
                    this.odoo.rpc_call('/web/dataset/call_button', {
                    model: 'sale.advance.payment.inv',
                    method: 'create_invoices',
                    args: [[ m ], {
                        active_ids: [soId],
                        open_invoices: true
                    }]
                }, (err: any, res: any) => {
                    if (err) { return reject(err); }
                    let invId = res.res_id;
                    // odoo 10 action
                     console.log('open invoice');
                     this.odoo.rpc_call('/web/dataset/call_button', {
                        model: 'account.invoice',
                        method: 'action_invoice_open',
                        args: [[ soId ]]
                        }, (err: any, res: any) => {
                            this.createDefaultResponseHandler(resolve, reject)(err, invId);
                        });
                });

            });
        });
    }

    async payCustomerInvoice(invoiceId: number, amount: number): Promise<any> {
        return this.execute((resolve, reject) => {
            this.odoo.get('account.invoice', {ids: [invoiceId], fields: ['number']}, (err, res) => {
                if (err) { return reject(err); }
                this.makePayment({
                    payment_type: 'inbound',
                    partner_type: 'customer',
                    partner_id: this.cache[partnerMarket.name],
                    journal_id: this.cache['INV'],
                    payment_method_id: 1, // TODO: lookup cash?
                    amount: amount, // TODO: from invoice or sim??
                    payment_date: this.currentDay,
                    communication: res[0].number,
                    invoice_ids: [[4, invoiceId, null]]
                }).then(resolve, reject);
            });
        });
    }

    async produce(currentDayTime:string, quantitySource: number, quantityProduced: number): Promise<any> {
        //TODO return promise?

        // create production
        let mo:any = {
            product_id: this.cache[productPaper.name],
            product_qty: quantityProduced,
            product_uom_id: 1,
            bom_id: this.cache['BOM'],
            date_planned: currentDayTime
        };

        let moId = await this.execute((resolve, reject) => {
            this.odoo.create('mrp.production', mo, this.createDefaultResponseHandler(resolve, reject));
        });
        console.log('moId', moId);

        // reserve (button checkavailability)
        await this.execute((resolve, reject) => {
            this.odoo.rpc_call('/web/dataset/call_button', {
                model: 'mrp.production',
                method: 'action_assign',
                args: [[moId]]
            }, this.createDefaultResponseHandler(resolve, reject));
        });
        // produce
        let produceId = await this.execute((resolve, reject) => {
            this.odoo.context.active_model =  "mrp.production";
		    this.odoo.context.active_id =  moId;
		    this.odoo.context.active_ids =  moId;
            this.odoo.create('mrp.product.produce', {
                serial: false,
			    production_id: moId,
			    product_qty: quantityProduced,
			    product_tracking: 'none',
			    lot_id: false,
			    consume_line_ids: []
            }, this.createDefaultResponseHandler(resolve, reject));
        });
        delete this.odoo.context.active_model;
		delete this.odoo.context.active_id;
		delete this.odoo.context.active_ids;
        console.log('produceId', produceId);
        //produce button
        await this.execute((resolve, reject) => {

            this.odoo.rpc_call('/web/dataset/call_button', {
                model: 'mrp.product.produce',
                method: 'do_produce',
                args: [[produceId]]
            }, this.createDefaultResponseHandler(resolve, reject));
        });

        // update dates
        console.log('update dates');
        await this.execute((resolve, reject) => {
            this.odoo.update('mrp.production', moId, {
                date_start: currentDayTime,
                date_finished: currentDayTime
            }, this.createDefaultResponseHandler(resolve, reject));
        });
        //postinventorybutton
        console.log('post inventory');
        await this.execute((resolve, reject) => {
            this.odoo.rpc_call('/web/dataset/call_button', {
                model: 'mrp.production',
                method: 'post_inventory',
                args: [[moId]]
            }, this.createDefaultResponseHandler(resolve, reject));
        });

        //buttondone
        console.log('production done');
        await this.execute((resolve, reject) => {
            this.odoo.rpc_call('/web/dataset/call_button', {
                model: 'mrp.production',
                method: 'button_mark_done',
                args: [[moId]]
            }, this.createDefaultResponseHandler(resolve, reject));
        });

        console.log('update stockMove dates');
        await this.updateStockMoveDate(['|', ['production_id', '=', moId], ['raw_material_production_id', '=', moId]], currentDayTime);



    }

}


// TODO: read accounts?
