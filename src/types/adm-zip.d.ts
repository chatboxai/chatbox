declare module 'adm-zip' {
  export default class AdmZip {
    constructor(input?: Buffer | string)
    extractAllTo(targetPath: string, overwrite?: boolean): void
  }
}
