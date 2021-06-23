require('dotenv-flow').config()
const axios = require('axios')
const { logger } = require('../logger')
const { cacheManager } = require('../cache')
const { parseMessage, getCurrentTime, updatePopularityStats, getTimePopularity } = require('../tz-chatbot')

let mockCacheGetValue = jest.fn().mockReturnValue(() => Promise.resolve())
jest.mock('../cache', () => ({
  cacheManager: jest.fn(() => ({
    connect: jest.fn(() => true),
    disconnect: jest.fn(() => true),
    set: jest.fn().mockReturnValue(() => Promise.resolve()),
    get: mockCacheGetValue,
    del: jest.fn().mockReturnValue(() => Promise.resolve()),
    incr: jest.fn().mockReturnValue(() => Promise.resolve())
  }))
}))

jest.mock('axios')

beforeEach(() => {
  cacheManager.mockClear()
})

describe('chat service', () => {
  describe('## parseMessage', () => {
    it('should parse a user text message correctly', () => {
      const userMessage = 'john: this is a simple text message'
      const { username, message, isCommand } = parseMessage(userMessage)

      expect(username).toBe('john')
      expect(message).toBe('this is a simple text message')
      expect(isCommand).toBeFalsy()
    });

    it('should parse a timepopularity command message correctly', () => {
      const userMessage = 'anna: !timepopularity America/New_York'
      const { username, message, isCommand, command, tz } = parseMessage(userMessage)

      expect(username).toBe('anna')
      expect(message).toBe('!timepopularity America/New_York')
      expect(command).toBe('!timepopularity')
      expect(tz).toBe('America/New_York')
      expect(isCommand).toBeTruthy()
    });

    it('should parse a timeat command message correctly', () => {
      const userMessage = 'anna: !timeat America/Argentina/Buenos_Aires'
      const { username, message, isCommand, command, tz } = parseMessage(userMessage)

      expect(username).toBe('anna')
      expect(message).toBe('!timeat America/Argentina/Buenos_Aires')
      expect(command).toBe('!timeat')
      expect(tz).toBe('America/Argentina/Buenos_Aires')
      expect(isCommand).toBeTruthy()
    });

    it('should ignore command if the message does not start with !', () => {
      const userMessage = 'john:        !timeat America/Chicago'
      const { message, isCommand, command } = parseMessage(userMessage)

      expect(message).toBe('       !timeat America/Chicago')
      expect(command).toBe(null)
      expect(isCommand).toBeFalsy()
    });

    it('should filter tz correctly', () => {
      const { tz: tz1 } = parseMessage('anna: !timeat America/Argentina/Buenos_Aires')
      const { tz: tz2 } = parseMessage('anna: !timeat PST8PDT')
      const { tz: tz3 } = parseMessage('anna: !timeat Etc/GMT+10')
      const { tz: tz4 } = parseMessage('anna: !timeat Etc/GMT-7')
      const { tz: tz5 } = parseMessage('anna: !timeat Europe/Amsterdam')
      const { tz: tz6 } = parseMessage('anna: !timeat HST')
      const { tz: tz7 } = parseMessage('anna: !timeat Pacific/Port_Moresby')
      const { tz: tz8 } = parseMessage('anna: !timeat Etc/UTC')
      const { tz: tz9 } = parseMessage('anna: !timeat America/Port-au-Prince')
      const { tz: tz10 } = parseMessage('anna: !timeat GMT')
      const { tz: tz11 } = parseMessage('anna: !timeat GMT-7')
      const { tz: tz12 } = parseMessage('anna: !timeat GMT+1')

      expect(tz1).toBe('America/Argentina/Buenos_Aires')
      expect(tz2).toBe('PST8PDT')
      expect(tz3).toBe('Etc/GMT+10')
      expect(tz4).toBe('Etc/GMT-7')
      expect(tz5).toBe('Europe/Amsterdam')
      expect(tz6).toBe('HST')
      expect(tz7).toBe('Pacific/Port_Moresby')
      expect(tz8).toBe('Etc/UTC')
      expect(tz9).toBe('America/Port-au-Prince')
      expect(tz10).toBe('Etc/GMT')
      expect(tz11).toBe('Etc/GMT-7')
      expect(tz12).toBe('Etc/GMT+1')
    });

    it('should throw an error if the message is not in the correct format', () => {
      const userMessage = 'john:format is not correct'

      expect(() => {
        parseMessage(userMessage)
      }).toThrow()
    });

    it('should throw an error if no message is passed', () => {
      expect(() => {
        parseMessage()
      }).toThrow()
    });
  })

  describe('## getCurrentTime', () => {

    it('should return the current time correctly', async () => {
      const tz = 'America/Argentina/Buenos_Aires'
      axios.get.mockResolvedValue({
        data: {
          abbreviation: '-03',
          datetime: '2021-06-20T19:20:55.207577-03:00',
          timezone: 'America/Argentina/Buenos_Aires',
          utc_datetime: '2021-06-20T22:20:55.207577+00:00',
          utc_offset: '-03:00'
        },
        status: 200
      })
      const { err, time } = await getCurrentTime(tz)
      expect(axios.get).toBeCalledWith(`${process.env.TIME_API}/timezone/${tz}`)
      expect(err).toBe(null)
      expect(time).toBe('20 Jun 2021 19:20')
    })

    it('should throw an error if tz is incorrect', async () => {
      const tz = 'Nowhere'
      logger.error = jest.fn()
      // eslint-disable-next-line prefer-promise-reject-errors
      axios.get.mockReturnValue(Promise.reject({
        response: {
          status: 404
        }
      }))
      const { err, time } = await getCurrentTime(tz)
      expect(axios.get).toBeCalledWith(`${process.env.TIME_API}/timezone/${tz}`)
      expect(err).toBe('unknown timezone')
      expect(logger.error).toHaveBeenCalledTimes(1)
      expect(time).toBe(undefined)
    })

    it('should return an error if tz is just a prefix', async () => {
      const tz = 'America'
      axios.get.mockResolvedValue({
        data: [
          'America/Adak',
          'America/Anchorage',
          'America/Araguaina',
          'America/Argentina/Buenos_Aires',
          'America/Argentina/Catamarca',
          'America/Argentina/Cordoba',
          'America/Argentina/Jujuy',
          'America/Argentina/La_Rioja',
          'America/Argentina/Mendoza'
        ],
        status: 404
      })
      const { err, time } = await getCurrentTime(tz)
      expect(axios.get).toBeCalledWith(`${process.env.TIME_API}/timezone/${tz}`)
      expect(err).toBe('unknown timezone')
      expect(time).toBe(undefined)
    })
  })

  describe('## updatePopularityStats', () => {
    it('should update popularity stats correctly for a single prefix timezone', async () => {
      const tz = 'GMT'
      await updatePopularityStats(tz)

      expect(cacheManager).toHaveBeenCalledTimes(1)
      const cache = cacheManager.mock.results[0].value

      expect(cache.connect).toHaveBeenCalledTimes(1)
      expect(cache.incr).toBeCalledWith(tz)
      expect(cache.incr).toHaveBeenCalledTimes(1)
      expect(cache.disconnect).toHaveBeenCalledTimes(1)
    })

    it('should update popularity stats correctly for a multiple prefix timezone', async () => {
      const tz = 'America/Argentina/Buenos_Aires'
      await updatePopularityStats(tz)

      expect(cacheManager).toHaveBeenCalledTimes(1)
      const cache = cacheManager.mock.results[0].value

      expect(cache.connect).toHaveBeenCalledTimes(1)
      expect(cache.incr).toHaveBeenNthCalledWith(1, 'America/Argentina/Buenos_Aires')
      expect(cache.incr).toHaveBeenNthCalledWith(2, 'America/Argentina')
      expect(cache.incr).toHaveBeenNthCalledWith(3, 'America')
      expect(cache.incr).toHaveBeenCalledTimes(3)
      expect(cache.disconnect).toHaveBeenCalledTimes(1)
    })
  })

  describe('## getTimePopularity', () => {
    it('should get the time popularity from the cache correctly', async () => {
      mockCacheGetValue = jest.fn().mockResolvedValue(99)
      const tz = 'GMT'
      const count = await getTimePopularity(tz)

      expect(cacheManager).toHaveBeenCalledTimes(1)
      const cache = cacheManager.mock.results[0].value

      expect(cache.connect).toHaveBeenCalledTimes(1)
      expect(cache.get).toBeCalledWith(tz)
      expect(cache.set).not.toHaveBeenCalled()
      expect(cache.disconnect).toHaveBeenCalledTimes(1)
      expect(count).toBe(99)
    })

    it('should set time popularity for a timezone when no value was found in the cache', async () => {
      mockCacheGetValue = jest.fn().mockResolvedValue(0)
      const tz = 'GMT'
      const count = await getTimePopularity(tz)

      expect(cacheManager).toHaveBeenCalledTimes(1)
      const cache = cacheManager.mock.results[0].value

      expect(cache.connect).toHaveBeenCalledTimes(1)
      expect(cache.get).toBeCalledWith(tz)
      expect(cache.set).toBeCalledWith(tz, 1)
      expect(cache.disconnect).toHaveBeenCalledTimes(1)
      expect(count).toBe(1)
    })

    it('should throw an error if failed to call the cache', async () => {
      logger.error = jest.fn()
      mockCacheGetValue = jest.fn().mockRejectedValue(new Error('get error'))
      const tz = 'GMT'
      try {
        await getTimePopularity(tz)
      } catch (e) {
        expect(cacheManager).toHaveBeenCalledTimes(1)
        const cache = cacheManager.mock.results[0].value

        expect(cache.connect).toHaveBeenCalledTimes(1)
        expect(cache.get).toBeCalledWith(tz)
        expect(cache.disconnect).not.toHaveBeenCalled()
        expect(logger.error).toHaveBeenCalledTimes(1)
        expect(e.message).toBe('get error')
      }
    })
  })
})
