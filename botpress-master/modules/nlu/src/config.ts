import { NLU } from 'botpress/sdk'

export interface Config extends NLU.Config {
  /**
   * If you want a fully on-prem installation, you can host
   * Facebook's Duckling on your own infrastructure and change this URL
   * Only relevant if @see ducklingEnabled is true
   * @default https://duckling.botpress.io
   */
  ducklingURL: string

  /**
   * @default true
   */
  ducklingEnabled: boolean

  /**
   * Whether or not you want your models to be trained and loaded on bot mounts
   * @default true
   * @deprecated > 12.2
   */
  preloadModels: boolean

  /**
   * The list of sources to load languages from
   * @default [{ "endpoint": "https://lang-01.botpress.io" }]
   */
  languageSources: NLU.LanguageSource[]
}
