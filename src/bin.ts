
export type Binnable = () => void | Promise<void>

export const createBin = () => {
    const bin: Binnable[] = []
    return Object.assign(
        (...rubbish: Binnable[]) => bin.push(...rubbish),
        {
            clean: (): void => {
                bin.forEach(binnable => binnable())
                bin.length = 0
            }
        }
    )
}