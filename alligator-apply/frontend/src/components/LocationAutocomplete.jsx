import SearchAutocomplete from './SearchAutocomplete';
import { filterLocationSuggestions } from '@/lib/jobSearchConstants';

export default function LocationAutocomplete(props) {
  return (
    <SearchAutocomplete
      {...props}
      placeholder={props.placeholder || 'City, state, remote'}
      getSuggestions={filterLocationSuggestions}
      minChars={1}
    />
  );
}
