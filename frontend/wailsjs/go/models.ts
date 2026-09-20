export namespace main {
	
	export class StoredAccount {
	    dsid: string;
	    email: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new StoredAccount(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dsid = source["dsid"];
	        this.email = source["email"];
	        this.name = source["name"];
	    }
	}
	export class AccountList {
	    accounts: StoredAccount[];
	    activeIndex: number;
	    signedIn: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AccountList(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.accounts = this.convertValues(source["accounts"], StoredAccount);
	        this.activeIndex = source["activeIndex"];
	        this.signedIn = source["signedIn"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AppResult {
	    id: number;
	    bundleID: string;
	    name: string;
	    version: string;
	    price: number;
	
	    static createFrom(source: any = {}) {
	        return new AppResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.bundleID = source["bundleID"];
	        this.name = source["name"];
	        this.version = source["version"];
	        this.price = source["price"];
	    }
	}
	export class ArtworkRequest {
	    id: string;
	    storefront: string;
	
	    static createFrom(source: any = {}) {
	        return new ArtworkRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.storefront = source["storefront"];
	    }
	}
	export class AuthInfo {
	    name: string;
	    email: string;
	    success: boolean;
	    authenticated: boolean;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new AuthInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.email = source["email"];
	        this.success = source["success"];
	        this.authenticated = source["authenticated"];
	        this.error = source["error"];
	    }
	}
	export class DownloadResult {
	    success: boolean;
	    outputPath?: string;
	    bundleID?: string;
	    name?: string;
	    version?: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new DownloadResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.outputPath = source["outputPath"];
	        this.bundleID = source["bundleID"];
	        this.name = source["name"];
	        this.version = source["version"];
	        this.error = source["error"];
	    }
	}
	export class InstallResult {
	    success: boolean;
	    bundleID?: string;
	    name?: string;
	    version?: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new InstallResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.bundleID = source["bundleID"];
	        this.name = source["name"];
	        this.version = source["version"];
	        this.error = source["error"];
	    }
	}
	export class InstalledApp {
	    bundleID: string;
	    name: string;
	    version: string;
	    dsid: string;
	    appStoreID: string;
	    storefront: string;
	
	    static createFrom(source: any = {}) {
	        return new InstalledApp(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.bundleID = source["bundleID"];
	        this.name = source["name"];
	        this.version = source["version"];
	        this.dsid = source["dsid"];
	        this.appStoreID = source["appStoreID"];
	        this.storefront = source["storefront"];
	    }
	}
	export class LoginResult {
	    success: boolean;
	    needs2FA: boolean;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new LoginResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.needs2FA = source["needs2FA"];
	        this.error = source["error"];
	    }
	}
	export class SearchResponse {
	    count: number;
	    apps: AppResult[];
	
	    static createFrom(source: any = {}) {
	        return new SearchResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.count = source["count"];
	        this.apps = this.convertValues(source["apps"], AppResult);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Version {
	    externalID: string;
	    displayVersion: string;
	    releaseDate: string;
	
	    static createFrom(source: any = {}) {
	        return new Version(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.externalID = source["externalID"];
	        this.displayVersion = source["displayVersion"];
	        this.releaseDate = source["releaseDate"];
	    }
	}

}

