// TODO: handle event to attach to dashbaord / odoo
// TODO: timer?
// TODO: display handle rule errors?
// recompute total
// where to put recompute history?
// stop supply before end?
// manual edit mode?
// TODO: wait for odoo transactions to terminate before continue

import { EventEmitter2 } from 'eventemitter2';
import * as uuid from 'node-uuid';
import { OdooAdapter} from './odoo_adapter';

export interface Company {
    name: string;
    currentStock: number;
    currentCash: number;
    dailySalesQty: number[];
    dailyPurchaseQty: number[];
    odoo?: {
        database: string;
        username: string;
        password: string;
    };
}

export interface GameState {
    id: string;
    description: string;
    startDate: string;

    // rules
    initialStock: number;
    initialCash: number;
    customerDayToPay: number;
    supplierDayToPay: number;
    supplierMaxOrderSize: number;
    marketPriceRange: number[];
    supplierPriceRange: number[];
    numberOfDays: number;
    productionRawToFinished: number;

    // states
    currentDay: number;
    dailyMarketPrices: number[];
    dailySupplierPrices: number[];
    companies: Company[];
    nextState: string;
    currentState: string;
}


function getRandomIntInclusive(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export class Game {
    input: Function;
    public pubsub: EventEmitter2;
    private nextState: Function;
    private state: GameState;
    private odooAdapters: OdooAdapter[] = [];
    private id: string;

    constructor () {
        this.pubsub = new EventEmitter2({
            wildcard: true
        });
        this.id = uuid.v4();
    }

    loadFromJson(json: string) {
        this.state = JSON.parse(json);
        this.id = this.state.id;
        if (typeof (<any>this)[this.state.nextState] === 'function') {
            this.nextState = (<any>this)[this.state.nextState];
        }
        // activate input states
        if (this.state.currentState && this.state.currentState.indexOf('accepting') === 0) {
            (<any>this)[this.state.currentState]();
        }
        this.odooAdapters.forEach((a) => {
            a.destroy();
        });
        this.odooAdapters = [];
        this.state.companies.forEach(this.createCompanyOdooAdapter.bind(this));
        this.pubsub.emit(`state`, this, {from: 'json', to: this.state.currentState});
    }

    createCompanyOdooAdapter(c: Company):OdooAdapter {
        if (c.odoo && c.odoo.database && c.odoo.username && c.odoo.password) {
            let odooAdapter = new OdooAdapter(this, c);
            this.odooAdapters.push(odooAdapter);
            return odooAdapter;
        }
        return undefined;
    }

    toJson():string {
        if (this.nextState) {
            this.state.nextState = this.nextState.name;
        }
        return JSON.stringify(this.state);
    }

    // return a copy avoid any external mutability;
    getState(): GameState {
        return JSON.parse(this.toJson());
    }

    start(name: string) {
        this.state = {
            id: this.id,
            description: name,
            startDate: new Date().toISOString(),

            // rules
            initialStock: 6,
            initialCash: 10,
            customerDayToPay: 2,
            supplierDayToPay: 1,
            supplierMaxOrderSize: 2,
            marketPriceRange: [1, 6],
            supplierPriceRange: [1, 8],
            numberOfDays: 10,
            productionRawToFinished:6,

            // states
            currentDay: -1,
            dailyMarketPrices: [],
            dailySupplierPrices: [],
            companies: [],
            nextState: undefined,
            currentState: 'gameStartState'
        };

        // wait for companies onboarding
        this.nextState = this.nextDayState;
    }

    getId():string {
        return this.id;
    }

    next():string {
        if (this.nextState) {
            let from = this.state.currentState;
            let to = this.nextState.name;
            let payload: any = this.nextState();
            this.state.currentState = to;
            this.pubsub.emit(`state`, this, {from: from, to: to, payload: payload});
            return to;
        }
        return undefined;
    }

    addCompany(name: string, odoo?:any):OdooAdapter {
        let c: Company = {
            name: name,
            currentCash: this.state.initialCash,
            currentStock: this.state.initialStock,
            dailySalesQty: [],
            dailyPurchaseQty: [],
            odoo: odoo
        };

        this.state.companies.push(c);
        this.pubsub.emit('companyAdded', this, c);
        return this.createCompanyOdooAdapter(c);
    }

    getCompany(name: string) {
        for(let i = 0; i < this.state.companies.length; i++) {
            if (name === this.state.companies[i].name) {
                return this.state.companies[i];
            }
        }
        return undefined;
    }

    private nextDayState() {
        if (this.state.currentDay < this.state.numberOfDays - 1) {
            this.state.currentDay++;
            this.nextState = this.decidingMarketPriceState;
        } else {
            this.nextState = this.gameEndState;
            this.next();
        }
    }

    private decidingMarketPriceState():any {
        let price = getRandomIntInclusive.apply(this, this.state.marketPriceRange);
        this.state.dailyMarketPrices[this.state.currentDay] = price;
        this.nextState = this.acceptingSalesState;
        return {day: this.state.currentDay, price: price};
    }

    private acceptingSalesState() {
        this.input = (companyName: string, salesQty: number) => {
            let company = this.getCompany(companyName);
            if (salesQty > 0 && company.currentStock >= salesQty) {
                company.dailySalesQty[this.state.currentDay] = salesQty;
                // notify or at end?
                return true;
            }
            return false;
        };
        this.nextState = this.salesDelvieryState;
    }

    private salesDelvieryState() {
        this.input = () => { return;};
        let sales: any = {};
        this.state.companies.forEach((company) => {
            if (!company.dailySalesQty[this.state.currentDay]) {
                company.dailySalesQty[this.state.currentDay] = 0;
            }
            company.currentStock -= company.dailySalesQty[this.state.currentDay];
            sales[company.name] = company.dailySalesQty[this.state.currentDay];
            // notify or at end?
        });
        this.nextState = this.customerPayingInvoicesState;
        return {day: this.state.currentDay, sales: sales};
    }

    private customerPayingInvoicesState() {
        let payOutForDay = this.state.currentDay - this.state.customerDayToPay;
        let sales: any = {};
        if (payOutForDay>= 0) {
            this.state.companies.forEach((company) => {
                company.currentCash += company.dailySalesQty[payOutForDay] * this.state.dailyMarketPrices[payOutForDay];
                sales[company.name] = company.dailySalesQty[payOutForDay];
                // payInvoice end?
                // TODO notify each company?
            });
        }
        this.nextState = this.decidingSupplierPriceState;
        return {day: this.state.currentDay, payOutForDay:payOutForDay, sales: sales, price: this.state.dailyMarketPrices[payOutForDay]};
    }

    private decidingSupplierPriceState():any {
        let price = getRandomIntInclusive.apply(this, this.state.supplierPriceRange);
        this.state.dailySupplierPrices[this.state.currentDay] = price;
        this.nextState = this.acceptingPurchasesState;
        return {day: this.state.currentDay, price: price};

    }

    private acceptingPurchasesState() {
        // TODO: forEach company check that will have enough money
        this.input = (companyName: string, purchaseQty: number) => {
            let company = this.getCompany(companyName);
            if (purchaseQty > 0 && purchaseQty <= this.state.supplierMaxOrderSize) {
                company.dailyPurchaseQty[this.state.currentDay] = purchaseQty;
                //notify or at end?
                return true;
            }
            return false;
        };
        this.nextState = this.deliveringPurchasesState;
    }

    private deliveringPurchasesState() {
        this.input = () => { return;};
        let supplyForPurchaseDay = this.state.currentDay - this.state.supplierDayToPay;
        let orders: any = {};
        if (supplyForPurchaseDay >= 0) {
            this.state.companies.forEach((company) => {
                if (!company.dailyPurchaseQty[supplyForPurchaseDay]) {
                    company.dailyPurchaseQty[supplyForPurchaseDay] = 0;
                }
                orders[company.name] =  company.dailyPurchaseQty[supplyForPurchaseDay];
                company.currentCash -= company.dailyPurchaseQty[supplyForPurchaseDay] *
                                    this.state.dailySupplierPrices[supplyForPurchaseDay];
                company.currentStock += company.dailyPurchaseQty[supplyForPurchaseDay] *
                                    this.state.productionRawToFinished;
                //notify or at end?
                //TODO: custom event for company
            });
        }
        this.nextState = this.nextDayState;
        return {day: this.state.currentDay, supplyForPurchaseDay: supplyForPurchaseDay,
            orders: orders, price: this.state.dailySupplierPrices[supplyForPurchaseDay]};
    }

    private gameEndState() {
        this.nextState = this.gameEndState;
    }
}

export class TestGame {
    constructor(private game:Game) {}

    start() {
        this.game.addCompany('a');
        this.game.addCompany('b');
        this.game.addCompany('c');
        this.game.addCompany('d');

        while (this.game.getState().currentState !== 'gameEndState') {
            let to = this.game.next();
            let state = this.game.getState();
            if (to === 'acceptingSalesState') {
                state.companies.forEach((c) => {
                    let qty = getRandomIntInclusive(0, c.currentStock);
                    this.game.input(c.name, qty);
                });
            }
            if ( to === 'acceptingPurchasesState') {
                state.companies.forEach((c) => {
                    let qty = getRandomIntInclusive(0, state.supplierMaxOrderSize);
                    this.game.input(c.name, qty);
                });
            }
        }
    }
}
