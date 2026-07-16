import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { bindStreamToResponse } from '../stream-lifecycle';

class FakeResponse extends EventEmitter {
  writableFinished = false;
}

describe('bindStreamToResponse', () => {
  it('destroys the source stream when the client disconnects before completion', () => {
    const stream = new PassThrough();
    const response = new FakeResponse();
    bindStreamToResponse(stream, response);

    response.emit('close');

    expect(stream.destroyed).toBe(true);
  });

  it('does not destroy a source after a normal response finish', () => {
    const stream = new PassThrough();
    const response = new FakeResponse();
    bindStreamToResponse(stream, response);
    response.writableFinished = true;

    response.emit('finish');
    response.emit('close');

    expect(stream.destroyed).toBe(false);
  });
});
