export const parseKoiosJsonCip68Metadata = (data: any) => {
  try {
    return Object.keys(data || {}).reduce((acc: any, key: string) => {
      acc[key] = parseDbSyncJsonCip68Metadata(data[key])
      return acc
    }, {} as any)
  } catch (error) {
    console.error("parseKoiosJsonCip68Metadata", error)
    return {}
  }
}

export const parseDbSyncJsonCip68Metadata = (data: any): any => {
  if (data.fields) {
    return data.fields.map((item: any) => parseDbSyncJsonCip68Metadata(item))
  }

  if (data.list) {
    return data.list.map((item: any) => parseDbSyncJsonCip68Metadata(item))
  }

  if (data.map) {
    return data?.map?.reduce((acc: any, item: any) => {
      acc[hexToString(item.k.bytes)] = parseDbSyncJsonCip68Metadata(item.v)
      return acc
    }, {} as any)
  }

  if (data.bytes) {
    return hexToString(data.bytes)
  }

  if (data.int) {
    return Number(data.int)
  }

  return undefined
}

export const hexToString = (hex: string): string => {
  let str = ""
  for (let i = 0; i < hex.length; i += 2) {
    const byte = hex.substring(i, i + 2)
    str += String.fromCharCode(parseInt(byte, 16))
  }
  return str
}
