declare module 'odoo' {

    interface OdooConfig {
        host: string;
        port?: number;
        database: string;
        username: string;
        password: string;
        protocol?: string;
    }

    interface SearchParams {
        domain: any[][];
    }

    interface SearchReadParams {
        domain: any[][];
        limit: number;
        offset?: number;
        order?: string;
        fields?: string[];
        [x: string]: any
    }

    interface GetParams {
        ids: number[];
        fields?: string[];
    }

    class Odoo {
        constructor(config: OdooConfig)
        connect(callback: (error: Error, result: any) => void):void;
        search(model: string, params: SearchParams, callback: (error: Error, result: any) => void):void;
        search_read(model: string, params: SearchReadParams, callback: (error: Error, result: any) => void):void;
        get(model: string, params: GetParams, callback: (error: Error, result: any) => void):void;
        browse_by_id(model: string, params: SearchReadParams, callback: (error: Error, result: any) => void):void;
        create(model: string, params: any, callback: (error: Error, result: any) => void):void;
        update(model: string, id: number, params: any, callback: (error: Error, result: any) => void):void;
        delete(model: string, id: number, callback: (error: Error, result: any) => void):void;
        rpc_call(endpoint: string, params: any, callback: (error: Error, result: any) => void):void;
        public context:any;
        public uid:number;
        public sid:string;
        public session_id:string;
    }

    export = Odoo;
}
