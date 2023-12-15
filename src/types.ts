export type ImageDataProvider = {
	providerType: "http" | "ipfs" | "base64" | ""
	providerImageData: string
	registryImageBase64: string
}
