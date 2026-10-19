import { TokenEstimationService } from '@chatbox/core/application/token-estimation'
import { currentBlobStorage } from '@/adapters/CurrentBlobStorage'
import { rendererApplication } from '@/app/renderer-application'

export const rendererTokenEstimation = new TokenEstimationService(currentBlobStorage, rendererApplication.sessions)
