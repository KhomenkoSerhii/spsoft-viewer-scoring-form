import { BRIDGE_CHANNEL, BRIDGE_VERSION } from './constants';
import type { BridgeMessageFor, BridgeMessageType, BridgePayloadByType } from './types';

export function createBridgeMessage<TType extends BridgeMessageType>(
  type: TType,
  payload: BridgePayloadByType[TType],
  messageId: string
): BridgeMessageFor<TType> {
  return {
    channel: BRIDGE_CHANNEL,
    version: BRIDGE_VERSION,
    type,
    messageId,
    payload,
  };
}
