import { ApiError, BaseError, NetworkError } from '@/packages/models/errors'

export class Dropbox {

    // private dropbox:
    private clientId: string;
    private clientSecret: string;

    constructor({clientId, clientSecret}: {clientId: string; clientSecret: string}) {
        this.clientSecret = clientSecret
        this.clientId = clientId
    }

    public  getLoginURL(): string {
        return `https://www.dropbox.com/oauth2/authorize?response_type=code&client_id=${this.clientId}`;
    }
    
    private getBaseURL(): string {
        return "/";
    }

    public async getAuthToken(authCode: string): Promise<string> {
        let requestError: ApiError | NetworkError | null = null
        try {
            const postData = {
                code: authCode,
                grant_type: 'authorization_code',
                client_id: this.clientId,
                client_secret: this.clientSecret,
            };

            const formBody = Object.entries(postData)
                .map(([key, value]) =>
                    `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
                )
                .join('&');

            const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                },
                body: formBody
            })
            if (!res.ok) {
                const err = await res.text().catch((e) => null)
                throw new ApiError(`Status Code ${res.status}, ${err}`)
            }

            let resJ = await res.json()
            return resJ.access_token
        } catch (e) {
            if (e instanceof BaseError) {
                requestError = e
            } else {
                const err = e as Error
                const origin = new URL(this.getBaseURL()).origin
                requestError = new NetworkError(err.message, origin)
            }
            await new Promise((resolve) => setTimeout(resolve, 500))
        }

        if (requestError) {
            throw requestError
        } else {
            throw new Error('Unknown error')
        }
    }

    private  getFreshAuthToken() : string {
        return this.clientId + this.clientSecret;
    }


    public async list(path: string): Promise<ListRes> {
        const postData = {
            path: path,
        };

        const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + this.getFreshAuthToken(),
            },
            body: JSON.stringify(postData),
        })
        if (!res.ok) {
            const err = await res.text().catch((e) => null)
            throw new ApiError(`Status Code ${res.status}, ${err}`)
        }
    }

    public async upload(): Promise<void> {

    }

    public async download(): Promise<void> {

    }
}

export const dropbox = new Dropbox({
    clientId: 'cx9li9ur8taq1z7',
    clientSecret: 'i8f9a1mvx3bijrt'
})