'use client';
import ReactCountUp, {type CountUpProps} from 'react-countup';

export function CountUp(props: Omit<CountUpProps, 'end'> & {end?: number}) {
  const {end = 0, ...rest} = props;
  return (
    <ReactCountUp
      enableScrollSpy
      scrollSpyOnce
      scrollSpyDelay={400}
      end={end}
      {...rest}
    />
  );
}
