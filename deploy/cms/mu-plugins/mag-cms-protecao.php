<?php
/**
 * Plugin Name: MAG CMS — proteção
 * Description: CMS só editorial: fora dos buscadores, sem XML-RPC, sem lista pública de usuários, atualizações automáticas.
 * Instalado em wp-content/mu-plugins/ (carrega sempre; não aparece para desativar no painel).
 */
defined('ABSPATH') || exit;

// Fora dos buscadores mesmo que alguém desmarque a opção em Configurações → Leitura.
add_filter('wp_robots', function ($robots) {
    $robots['noindex'] = true;
    $robots['nofollow'] = true;
    return $robots;
});
add_filter('wp_sitemaps_enabled', '__return_false');

// Sem XML-RPC (o Nginx também bloqueia o arquivo).
add_filter('xmlrpc_enabled', '__return_false');

// Logins dos usuários não ficam públicos: API de usuários e /?author=N só para quem está logado.
add_filter('rest_endpoints', function ($endpoints) {
    if (!is_user_logged_in()) {
        unset($endpoints['/wp/v2/users'], $endpoints['/wp/v2/users/(?P<id>[\d]+)']);
    }
    return $endpoints;
});
add_action('template_redirect', function () {
    if (isset($_GET['author']) && !is_user_logged_in()) {
        wp_safe_redirect(home_url('/'), 301);
        exit;
    }
});

// Atualizações automáticas de segurança: núcleo (menores), plugins e temas.
add_filter('auto_update_plugin', '__return_true');
add_filter('auto_update_theme', '__return_true');
