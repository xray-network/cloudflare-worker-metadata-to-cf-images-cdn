/**
 * @@ XRAY NETWORK | Graph | Metadata images from/to Cloudflare Images CDN
 * Proxying CIP25, CIP26, CIP68, or REGISTRY images from/to Cloudflare Images CDN
 * Learn more at https://developers.cloudflare.com/workers/
 */

import * as Types from "./types"

const API_GROUP = "cdn"
const API_TYPES = ["metadata", "registry"]
const API_IPFS = "https://nftstorage.link"
const API_CLOUDFLARE = "https://api.cloudflare.com/client/v4"
const API_IMAGEDELIVERY = "https://imagedelivery.net"
const API_OUTPUT = "https://output-load-balancer.xray-network.workers.dev/output"
const API_KOIOS = (network: string) => `${API_OUTPUT}/${network}/koios/api/v1` // https://koios.rest can be used also
const ALLOWED_METHODS = ["GET", "POST", "OPTIONS", "HEAD"]
const ALLOWED_NETWORKS = ["mainnet", "preprod", "preview"]
const IMG_METADATA_SIZES = ["32", "64", "128", "256", "512", "1024", "2048"]
const IMG_REGISTRY_SIZES = ["32", "64", "128", "256", "512"]
const IMG_CHECKING_SIZE = "16"
const IMG_SIZE_LIMIT = 20_000_000 // Cloudflare upload limit in bytes, if exceeded serve the original image

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const { segments, pathname, search } = getUrlSegments(new URL(request.url))
		const [group, network, type, fingerprint, size] = segments

		if (request.method === "OPTIONS") {
			return new Response(null, {
				headers: {
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": ALLOWED_METHODS.join(", "),
					"Access-Control-Max-Age": "86400",
					"Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept",
				},
			})
		}

		if (!ALLOWED_METHODS.includes(request.method)) return throw405()
		if (group !== API_GROUP) return throw404()
		if (!API_TYPES.includes(type)) return throw404()
		if (!ALLOWED_NETWORKS.includes(network)) return throw404()
		if (!fingerprint) return throw404()

		try {
			if (type === "metadata") {
				if (!IMG_METADATA_SIZES.includes(size)) return throw404WrongSize()
				try {
					// Check if image exist in CF Images and serve image
					await checkImageExistByAPI(type, fingerprint, env) // TODO: see function description
					// await checkImageExistByHTTP(type, fingerprint, env) // TODO: see function description
					return await serveImage(type, fingerprint, size, request, env)
				} catch {
					// If not found, get image from CIP25/CIP68 metadata, upload to CF and serve image
					const imageProvider = await getImageDataProvider(fingerprint, network, env)

					if (imageProvider.metadataProvider.type === "base64") {
						const imageBlob = blobFromBase64(imageProvider.metadataProvider.data)
						await uploadImage(imageBlob, type, fingerprint, env)
						return await serveImage(type, fingerprint, size, request, env)
					}

					if (imageProvider.metadataProvider.type === "http" || imageProvider.metadataProvider.type === "ipfs") {
						const imageRemoteURL = imageProvider.metadataProvider.data
						const imageResponse = await fetch(imageRemoteURL)
						if (!imageResponse.ok) throw new Error("Error getting image from HTTP/IPFS")
						if (Number(imageResponse.headers.get("content-length") || 0) > IMG_SIZE_LIMIT) {
							// serve original file
							return new Response(imageResponse.body, {
								headers: addExpirationHeaders(imageResponse.headers, 864_000_000_000),
							})
						}
						const imageBlob = await imageResponse.blob()
						await uploadImage(imageBlob, type, fingerprint, env)
						return await serveImage(type, fingerprint, size, request, env)
					}
				}
			}

			if (type === "registry") {
				if (!IMG_REGISTRY_SIZES.includes(size)) return throw404WrongSize()
				try {
					// Check if image exist in CF Images and serve image
					await checkImageExistByAPI(type, fingerprint, env) // TODO: see function description
					// await checkImageExistByHTTP(type, fingerprint, env) // TODO: see function description
					return await serveImage(type, fingerprint, size, request, env)
				} catch {
					// If not found, get image from REGISTRY, upload to CF and serve image
					const { registryBase64Image } = await getImageDataProvider(fingerprint, network, env)
					if (registryBase64Image) {
						const imageBlob = blobFromBase64(registryBase64Image)
						await uploadImage(imageBlob, type, fingerprint, env)
						return await serveImage(type, fingerprint, size, request, env)
					}
				}
			}

			return throw404NoImage()
		} catch (error) {
			console.log(error)
			return throw404NoImage()
		}
	},
}

// TODO: Checking image by CF API slows down request by ~800ms and has burst limits
// There is because the first fetch reponse (404) is cached inside CF Edge, and it doesn't reset for 30-60 seconds even after the image upload,
// so we have to check if the image is in CF Images via the API, rather than directly accessing https://imagedelivery.net.
const checkImageExistByAPI = async (type: string, fingerprint: string, env: Env) => {
	console.log("Checking image is exists (API).........")
	const result = await fetch(`${API_CLOUDFLARE}/accounts/${env.ACCOUNT_ID}/images/v1/${type}/${fingerprint}`, {
		headers: { Authorization: `Bearer ${env.ACCOUNT_KEY}` },
	})
	if (result.ok) return
	throw new Error("Image doesn't exist")
}

// TODO: Still second fetch is cached even if check a different size (IMG_CHECKING_SIZE)
const checkImageExistByHTTP = async (type: string, fingerprint: string, env: Env) => {
	console.log("Checking image is exists (HTTP).........")
	const result = await fetch(`${API_IMAGEDELIVERY}/${env.ACCOUNT_HASH}/${type}/${fingerprint}/${IMG_CHECKING_SIZE}`)
	if (result.ok) return
	throw new Error("Image doesn't exist")
}

const serveImage = async (
	type: string,
	fingerprint: string,
	size: string,
	request: Request,
	env: Env,
) => {
	console.log("Serving image.........")
	const imageResponse = await fetch(`${API_IMAGEDELIVERY}/${env.ACCOUNT_HASH}/${type}/${fingerprint}/${size}`, {
		headers: request.headers,
	})

	const headersUpdated = new Headers(imageResponse.headers)
	headersUpdated.delete("Content-Security-Policy")

	// Handle not modified status
	if (imageResponse.status === 304) {
		return new Response(null, {
			headers: headersUpdated,
			status: 304,
		})
	}

	// Send response with caching headers
	if (imageResponse.ok) {
		return new Response(imageResponse.body, {
			headers: addExpirationHeaders(headersUpdated, 864_000_000_000),
		})
	}

	throw new Error("Error getting image from CF")
}

const uploadImage = async (image: Blob, type: string, fingerprint: string, env: Env) => {
	console.log("Uploading image.........")
	const imageFormData = new FormData()
	imageFormData.append("file", image)
	imageFormData.append("id", `${type}/${fingerprint}`)
	const imageUploadResponse = await fetch(`${API_CLOUDFLARE}/accounts/${env.ACCOUNT_ID}/images/v1`, {
		method: "POST",
		headers: { Authorization: `Bearer ${env.ACCOUNT_KEY}` },
		body: imageFormData,
	})
	if (!imageUploadResponse.ok) throw new Error("Error uploading image to CF")
	return await imageUploadResponse.json()
}

const deleteImage = async (type: string, fingerprint: string, env: Env) => {
	await fetch(`${API_CLOUDFLARE}/accounts/${env.ACCOUNT_ID}/images/v1/${type}/${fingerprint}`, {
		method: "DELETE",
		headers: { Authorization: `Bearer ${env.ACCOUNT_KEY}` },
	})
}

const getImageDataProvider = async (
	fingerprint: string,
	network: string,
	env: Env
): Promise<Types.ImageDataProvider> => {
	console.log("Getting image source provider.........")
	const assetInfoResponse = await fetch(`${API_KOIOS(network)}/asset_list?fingerprint=eq.${fingerprint}`)
	if (!assetInfoResponse.ok) throw new Error("Error getting asset info")
	const assetInfoResult: any = await assetInfoResponse.json()
	const assetPolicyId = assetInfoResult[0]?.policy_id
	const assetName = assetInfoResult[0]?.asset_name

	const assetDataResponse = await fetch(
		`${API_KOIOS(network)}` +
			`/asset_info?select=asset_name_ascii,minting_tx_metadata,cip68_metadata,token_registry_metadata`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ _asset_list: [[assetPolicyId, assetName]] }),
		}
	)
	if (!assetDataResponse.ok) throw new Error("Error getting asset data")

	const assetDataResult: any = await assetDataResponse.json()
	const assetNameAscii = assetDataResult[0]?.asset_name_ascii
	const assetTxMetadata = assetDataResult[0]?.minting_tx_metadata
	const cip68Metadata = assetDataResult[0]?.cip68_metadata
	const tokenRegistryMetadata = assetDataResult[0]?.token_registry_metadata

	const result = {
		metadataProvider: {},
		registryBase64Image: tokenRegistryMetadata?.logo || "",
	}

	let imageURI =
		assetTxMetadata?.["721"]?.[assetPolicyId]?.[assetNameAscii]?.image ||
		assetTxMetadata?.["721"]?.[assetPolicyId]?.[assetName]?.image

	if (cip68Metadata) {
		// TODO: imageURI from CIP68 metadata
	}

	if (!imageURI) throw new Error("Image in 721 metadata not found")

	if (Array.isArray(imageURI)) {
		imageURI = imageURI.join("")
	}

	if (typeof imageURI == "string") {
		if (imageURI.startsWith("https://") || imageURI.startsWith("http://")) {
			return {
				...result,
				metadataProvider: {
					type: "http",
					data: imageURI,
				},
			}
		} else if (imageURI.startsWith("ipfs://")) {
			return {
				...result,
				metadataProvider: {
					type: "ipfs",
					data: `${API_IPFS}/ipfs/${imageURI.replaceAll("ipfs://", "").replaceAll("ipfs/", "")}`,
				},
			}
		} else if (imageURI.startsWith("data:image/")) {
			return {
				...result,
				metadataProvider: {
					type: "base64",
					data: imageURI,
				},
			}
		}
	}

	throw new Error("Error getting image data from CIP25 metadata")
}

const getUrlSegments = (url: URL) => {
	const pathname = url.pathname
	const search = url.search
	const segments = pathname.replace(/^\//g, "").split("/")

	return {
		segments,
		pathname,
		search,
	}
}

const blobFromBase64 = (base64String: string) => {
	const byteArray = Uint8Array.from(
		atob(base64String)
			.split("")
			.map((char) => char.charCodeAt(0))
	)
	return new Blob([byteArray])
}

const addExpirationHeaders = (headers: Headers, time: number) => {
	const headersSet = new Headers(headers)
	headersSet.set("Cache-Control", `public, max-age=${time.toString()}`)
	headersSet.set("Expires", new Date(Date.now() + time).toUTCString())
	return headersSet
}

const throw404 = () => {
	return new Response("404. API not found. Check if the request is correct", { status: 404 })
}

const throw404NoImage = () => {
	return new Response("404. Image not found! Check if the request is correct", { status: 404 })
}

const throw413ImageTooLarge = () => {
	return new Response(`413. Image too large! The image exceeded the size limit of ${IMG_SIZE_LIMIT} bytes`, {
		status: 413,
	})
}

const throw404CIPNotSupported = () => {
	return new Response("404. Current CIP is not yet supported", { status: 404 })
}

const throw404WrongSize = () => {
	return new Response("404. Image size not found! Check if the request is correct", { status: 404 })
}

const throw405 = () => {
	return new Response("405. Method not allowed. Check if the request is correct", { status: 405 })
}

const throw500 = () => {
	return new Response("500. Server error! Something went wrong", { status: 500 })
}

const throwReject = (response: Response) => {
	return new Response(response.body, response)
}