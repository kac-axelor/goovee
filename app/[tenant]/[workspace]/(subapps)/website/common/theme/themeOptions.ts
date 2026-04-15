// TODO: dynamic font and color theme switching is currently not supported.
// Previously these CSS files were served from public/css/ (compiled via website:sass).
// They need to be either served via a Next.js route handler or compiled to public/website/css/.
const changeColor = (colorPath?: string | null, fontPath?: string | null) => {
  // remove previous link
  document.getElementById('custom-theme')?.remove();
  document.getElementById('custom-font')?.remove();

  // add new color link
  if (colorPath) {
    const link = document.createElement('link');
    link.setAttribute('href', colorPath);
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('id', 'custom-theme');
    document.querySelector('head')?.appendChild(link);
  }

  // add new custom font
  if (fontPath) {
    const link = document.createElement('link');
    link.setAttribute('href', fontPath);
    link.setAttribute('rel', 'preload');
    link.setAttribute('as', 'style');
    link.setAttribute('onload', "this.rel='stylesheet'");
    link.setAttribute('id', 'custom-font');
    document.querySelector('head')?.appendChild(link);
  }
};

const changeTheme = (pathname: string) => {
  switch (pathname) {
    case '/':
      changeColor('/css/colors/gv-grape.css', '/css/fonts/gv-space.css');
      break;

    case '/demo-1':
      changeColor('/css/colors/gv-yellow.css', '/css/fonts/gv-thicccboi.css');
      break;

    case '/demo-2':
      changeColor(null, '/css/fonts/gv-dm.css');
      break;

    case '/demo-3':
      changeColor('/css/colors/gv-aqua.css', '/css/fonts/gv-thicccboi.css');
      break;

    case '/demo-4':
      changeColor('/css/colors/gv-violet.css', '/css/fonts/gv-dm.css');
      break;

    case '/demo-6':
      changeColor('/css/colors/gv-aqua.css', '/css/fonts/gv-thicccboi.css');
      break;

    case '/demo-7':
      changeColor('/css/colors/gv-purple.css', '/css/fonts/gv-thicccboi.css');
      break;

    case '/demo-8':
      changeColor('/css/colors/gv-aqua.css', '/css/fonts/gv-dm.css');
      break;

    case '/demo-9':
      changeColor(null, '/css/fonts/gv-dm.css');
      break;

    case '/demo-10':
      changeColor('/css/colors/gv-orange.css', '/css/fonts/gv-thicccboi.css');
      break;

    case '/demo-11':
      changeColor('/css/colors/gv-purple.css', null);
      break;

    case '/demo-12':
      changeColor('/css/colors/gv-orange.css', null);
      break;

    case '/demo-13':
      changeColor('/css/colors/gv-purple.css', null);
      break;

    case '/demo-14':
      changeColor('/css/colors/gv-violet.css', '/css/fonts/gv-thicccboi.css');
      break;

    case '/demo-16':
      changeColor('/css/colors/gv-pink.css', null);
      break;

    case '/demo-17':
      changeColor('/css/colors/gv-navy.css', null);
      break;

    case '/demo-18':
      changeColor('/css/colors/gv-grape.css', '/css/fonts/gv-urbanist.css');
      break;

    case '/demo-19':
      changeColor('/css/colors/gv-violet.css', '/css/fonts/gv-urbanist.css');
      break;

    case '/demo-20':
      changeColor('/css/colors/gv-purple.css', '/css/fonts/gv-urbanist.css');
      break;

    case '/demo-21':
      changeColor('/css/colors/gv-sky.css', '/css/fonts/gv-urbanist.css');
      break;

    case '/demo-22':
      changeColor('/css/colors/gv-purple.css', '/css/fonts/gv-urbanist.css');
      break;

    case '/demo-23':
      changeColor('/css/colors/gv-leaf.css', '/css/fonts/gv-urbanist.css');
      break;

    case '/demo-24':
      changeColor('/css/colors/gv-yellow.css', '/css/fonts/gv-urbanist.css');
      break;

    case '/demo-25':
      changeColor('/css/colors/gv-pink.css', '/css/fonts/gv-urbanist.css');
      break;

    case '/demo-26':
      changeColor('/css/colors/gv-grape.css', '/css/fonts/gv-urbanist.css');
      break;

    case '/demo-27':
      changeColor('/css/colors/gv-navy.css', null);
      break;

    case '/demo-28':
      changeColor('/css/colors/gv-purple.css', '/css/fonts/gv-space.css');
      break;

    case '/demo-29':
      changeColor('/css/colors/gv-grape.css', '/css/fonts/gv-space.css');
      break;

    case '/demo-30':
      changeColor('/css/colors/gv-grape.css', '/css/fonts/gv-space.css');
      break;

    case '/demo-31':
      changeColor(null, '/css/fonts/gv-gv-space.css');
      break;

    case '/demo-32':
      changeColor(null, '/css/fonts/gv-gv-space.css');
      break;

    case '/demo-33':
      changeColor('/css/colors/gv-navy.css', '/css/fonts/gv-space.css');
      break;

    case '/demo-34':
      changeColor('/css/colors/gv-purple.css', '/css/fonts/gv-thicccboi.css');
      break;

    default:
      changeColor();
      return;
  }
};

export default changeTheme;
