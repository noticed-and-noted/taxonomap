/** The ramp's colours outside a browser. */
import { rampById, rampColors } from '~/lib/ramp';

it('uses the default ramp’s colours without a document', () => {
  expect(rampColors()).toEqual(rampById('lichen-fern').colors.slice(1));
});
