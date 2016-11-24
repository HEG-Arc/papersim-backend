import { Game, Company, GameState } from './sim';
import { OdooAdapter, productCard, productPaper, partnerMarket, partnerSupplier} from './odoo_adapter';

let game = new Game();
game.start('test');
let odooAdapter:OdooAdapter = game.addCompany('A1', {
    database: 'edu-paper2',
    username: 'edu-paper@mailinator.com',
    password: '12345678'
});

odooAdapter.config.autoCommitPo = true;
odooAdapter.config.autoCommitSo = true;


odooAdapter.updateGameStateAndDay(game);

async function test(){
    await setup();
    //await testSales();
    //await testSupply();
    //await testMrp();
}

async function setup(){
    // TODO: checkOrUpdate
    //await odooAdapter.createConfig();
    await odooAdapter.updateNames();
    await odooAdapter.checkConfig();
}

// test calls to odoo, not business logic
async function testSales() {
   console.log('decidingMarketPriceState');
        // setup market price and SO
    await odooAdapter.updateSalesProductPrice(odooAdapter.cache[productCard.name], 10);
    console.log('createSalesOrder');
    var soId = await odooAdapter.createSalesOrder(odooAdapter.cache[partnerMarket.name], odooAdapter.cache[productCard.name], 10);
    console.log('soId', soId);
    console.log('acceptingSalesState');
    var soId = await odooAdapter.readAndCheckSo(soId);
    console.log('soId', soId);
    console.log('salesDelvieryState');
    await odooAdapter.deliverSales(soId);
    console.log('createCustomerInvoice');
    var invoiceId= await odooAdapter.createCustomerInvoice(soId);
    console.log('invoiceId', invoiceId);
    console.log('customerPayingInvoicesState');
    await odooAdapter.payCustomerInvoice(invoiceId, 10);
}

async function testSupply(){
    console.log('decidingSupplierPriceState');
    await odooAdapter.updateSupplierProductPrice(odooAdapter.cache[partnerSupplier.name], odooAdapter.cache[productPaper.name], 10);
    console.log('createPurchaseOrder');
    var poId = await odooAdapter.createPurchaseOrder(odooAdapter.cache[partnerSupplier.name], odooAdapter.cache[productPaper.name], 10);

    console.log('acceptingPurchasesState');
    poId = await odooAdapter.readAndCheckPo(poId);
    console.log('poId', poId);
    console.log('deliveringPurchasesState');
    await odooAdapter.deliverSupplies(poId);
    console.log('createPurchaseInvoice');
    var invoiceId = await odooAdapter.createPurchaseInvoice(poId, odooAdapter.cache[productPaper.name], 1, 10);
    console.log('invoiceId', invoiceId);
    console.log('paySupplierInvoice');
    await odooAdapter.paySupplierInvoice(invoiceId);
    console.log('lockPurchaseOrder');
    await odooAdapter.lockPurchaseOrder(poId);
}

async function testMrp(){
    console.log('produce');
    await odooAdapter.produce('2016-01-01', 6);
}

test();

/*
setup().then(()=>{

    odooAdapter.odoo.search('account.invoice', {
        domain: [
            ['origin', '=', 'SO020']
        ]
    }, (err, res) => {
        console.log(err, res);
    });

    odooAdapter.odoo.get('purchase.order.line', {ids: [5]}, (err, res) => {
        console.log(err, res);
    });

});
*/
