export type ImageDataProvider = {
	metadataProvider: {
		type: "http" | "ipfs" | "base64"
		data: string
	}
	registryBase64Image: string
}
